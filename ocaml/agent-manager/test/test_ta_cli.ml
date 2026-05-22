type command_result = {
  status : Unix.process_status;
  stdout : string;
  stderr : string;
}

let initial_cwd = Sys.getcwd ()

let ta_exe () =
  match Sys.getenv_opt "TA_EXE" with
  | Some value when Filename.is_relative value ->
      Filename.concat initial_cwd value
  | Some value -> value
  | None -> Alcotest.fail "TA_EXE is not set"

let fixture name = Filename.concat "fixtures" name
let remove_noerr path = try Sys.remove path with Sys_error _ -> ()

let read_all channel =
  let buffer = Buffer.create 256 in
  let bytes = Bytes.create 4096 in
  let rec loop () =
    match input channel bytes 0 (Bytes.length bytes) with
    | 0 -> Buffer.contents buffer
    | read ->
        Buffer.add_subbytes buffer bytes 0 read;
        loop ()
  in
  loop ()

let run_ta args =
  let argv = Array.of_list (ta_exe () :: args) in
  let stdout_tmp, stdout_channel = Filename.open_temp_file "ta-cli" ".out" in
  let stderr_tmp, stderr_channel = Filename.open_temp_file "ta-cli" ".err" in
  Fun.protect
    ~finally:(fun () ->
      close_out_noerr stdout_channel;
      close_out_noerr stderr_channel;
      remove_noerr stdout_tmp;
      remove_noerr stderr_tmp)
    (fun () ->
      let pid =
        Unix.create_process (ta_exe ()) argv Unix.stdin
          (Unix.descr_of_out_channel stdout_channel)
          (Unix.descr_of_out_channel stderr_channel)
      in
      let _, status = Unix.waitpid [] pid in
      close_out stdout_channel;
      close_out stderr_channel;
      let stdout_in = open_in stdout_tmp in
      let stderr_in = open_in stderr_tmp in
      Fun.protect
        ~finally:(fun () ->
          close_in_noerr stdout_in;
          close_in_noerr stderr_in)
        (fun () ->
          { status; stdout = read_all stdout_in; stderr = read_all stderr_in }))

let waitpid_with_timeout ~seconds pid =
  let deadline = Unix.gettimeofday () +. seconds in
  let rec loop () =
    match Unix.waitpid [ Unix.WNOHANG ] pid with
    | 0, _ when Unix.gettimeofday () >= deadline ->
        Unix.kill pid Sys.sigkill;
        snd (Unix.waitpid [] pid)
    | 0, _ ->
        Unix.sleepf 0.05;
        loop ()
    | _, status -> status
  in
  loop ()

let run_ta_with_input ~env ~stdin args =
  let argv = Array.of_list (ta_exe () :: args) in
  let env =
    Unix.environment () |> Array.to_list
    |> List.filter (fun value ->
        not
          (List.exists
             (fun (name, _) -> String.starts_with ~prefix:(name ^ "=") value)
             env))
    |> fun base ->
    base @ List.map (fun (name, value) -> name ^ "=" ^ value) env
    |> Array.of_list
  in
  let stdin_tmp, stdin_channel = Filename.open_temp_file "ta-cli" ".in" in
  let stdout_tmp, stdout_channel = Filename.open_temp_file "ta-cli" ".out" in
  let stderr_tmp, stderr_channel = Filename.open_temp_file "ta-cli" ".err" in
  Fun.protect
    ~finally:(fun () ->
      close_out_noerr stdin_channel;
      close_out_noerr stdout_channel;
      close_out_noerr stderr_channel;
      remove_noerr stdin_tmp;
      remove_noerr stdout_tmp;
      remove_noerr stderr_tmp)
    (fun () ->
      output_string stdin_channel stdin;
      close_out stdin_channel;
      let stdin_in = open_in stdin_tmp in
      Fun.protect
        ~finally:(fun () -> close_in_noerr stdin_in)
        (fun () ->
          let pid =
            Unix.create_process_env (ta_exe ()) argv env
              (Unix.descr_of_in_channel stdin_in)
              (Unix.descr_of_out_channel stdout_channel)
              (Unix.descr_of_out_channel stderr_channel)
          in
          let status = waitpid_with_timeout ~seconds:5.0 pid in
          close_out stdout_channel;
          close_out stderr_channel;
          let stdout_in = open_in stdout_tmp in
          let stderr_in = open_in stderr_tmp in
          Fun.protect
            ~finally:(fun () ->
              close_in_noerr stdout_in;
              close_in_noerr stderr_in)
            (fun () ->
              {
                status;
                stdout = read_all stdout_in;
                stderr = read_all stderr_in;
              })))

let check_exit label expected = function
  | Unix.WEXITED code -> Alcotest.(check int) label expected code
  | Unix.WSIGNALED signal ->
      Alcotest.failf "%s: process signaled %d" label signal
  | Unix.WSTOPPED signal -> Alcotest.failf "%s: process stopped %d" label signal

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let line_count value =
  let lines = String.split_on_char '\n' value in
  match List.rev lines with
  | "" :: rest -> List.length rest
  | _ -> List.length lines

let with_temp_state f =
  let path = Filename.temp_file "ta-cli-state" ".json" in
  Fun.protect ~finally:(fun () -> remove_noerr path) (fun () -> f path)

let mkdir_noerr path mode =
  try Unix.mkdir path mode with Unix.Unix_error (Unix.EEXIST, _, _) -> ()

let with_temp_workspace f =
  let rec create attempt =
    let path =
      Filename.concat
        (Filename.get_temp_dir_name ())
        (Printf.sprintf "ta-cli-workspace-%d-%d" (Unix.getpid ()) attempt)
    in
    try
      Unix.mkdir path 0o700;
      path
    with Unix.Unix_error (Unix.EEXIST, _, _) -> create (attempt + 1)
  in
  let path = create 0 in
  Fun.protect
    ~finally:(fun () ->
      remove_noerr (Filename.concat path ".ta-state.json");
      remove_noerr (Filename.concat path "ta.json");
      remove_noerr
        (Filename.concat path "ocaml/agent-manager/examples/ta.example.json");
      remove_noerr (Filename.concat path "examples/ta.example.json");
      remove_noerr (Filename.concat path ".harness/ta.json");
      (try Unix.rmdir (Filename.concat path "examples")
       with Unix.Unix_error _ -> ());
      (try Unix.rmdir (Filename.concat path ".harness")
       with Unix.Unix_error _ -> ());
      try Unix.rmdir path with Unix.Unix_error _ -> ())
    (fun () -> f path)

let with_chdir path f =
  let cwd = Sys.getcwd () in
  Sys.chdir path;
  Fun.protect ~finally:(fun () -> Sys.chdir cwd) f

let read_file path =
  let channel = open_in path in
  Fun.protect
    ~finally:(fun () -> close_in_noerr channel)
    (fun () -> read_all channel)

let write_file path contents =
  let channel = open_out path in
  Fun.protect
    ~finally:(fun () -> close_out_noerr channel)
    (fun () -> output_string channel contents)

let write_default_config dir =
  let harness = Filename.concat dir ".harness" in
  mkdir_noerr harness 0o700;
  write_file
    (Filename.concat harness "ta.json")
    (read_file (fixture "ta-valid.json"))

let write_source_tree_example_config dir =
  let examples = Filename.concat dir "examples" in
  mkdir_noerr examples 0o700;
  write_file
    (Filename.concat examples "ta.example.json")
    (read_file (fixture "ta-valid.json"))

let save_state path =
  match Ta_core.Workspace_config.load (fixture "ta-valid.json") with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config -> (
      match Ta_core.State_store.of_config config with
      | Error errors ->
          Alcotest.fail
            (String.concat "\n"
               (List.map Ta_core.Workspace_config.error_to_string errors))
      | Ok store -> (
          match Ta_core.State_file.save ~path store with
          | Ok () -> ()
          | Error error ->
              Alcotest.fail (Ta_core.State_file.error_to_string error)))

let expect_state_dashboard () =
  with_temp_state (fun path ->
      save_state path;
      let result = run_ta [ "--state"; path; "--width"; "92" ] in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      Alcotest.(check bool)
        "dashboard header" true
        (contains_substring ~needle:"TA Dashboard" result.stdout);
      Alcotest.(check bool)
        "workspace" true
        (contains_substring ~needle:"fixture" result.stdout);
      Alcotest.(check bool)
        "preview" true
        (contains_substring ~needle:"Preview: fixture/lead" result.stdout))

let expect_state_dashboard_replays_key () =
  with_temp_state (fun path ->
      save_state path;
      let result =
        run_ta [ "--state"; path; "--width"; "92"; "--key"; "Down" ]
      in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      Alcotest.(check bool)
        "selected qa preview" true
        (contains_substring ~needle:"Preview: fixture/qa" result.stdout))

let expect_rejects_bad_width () =
  with_temp_state (fun path ->
      save_state path;
      let result = run_ta [ "--state"; path; "--width"; "0" ] in
      check_exit "exit" 2 result.status;
      Alcotest.(check bool)
        "width error" true
        (contains_substring ~needle:"--width must be positive" result.stderr))

let expect_state_dashboard_respects_height () =
  with_temp_state (fun path ->
      save_state path;
      let result =
        run_ta
          [
            "--state";
            path;
            "--width";
            "80";
            "--height";
            "12";
            "--key";
            "p";
            "--key";
            "Right";
          ]
      in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      Alcotest.(check int) "height" 12 (line_count result.stdout);
      Alcotest.(check bool)
        "clip marker" true
        (contains_substring ~needle:"line(s) clipped; increase --height"
           result.stdout))

let expect_rejects_bad_height () =
  with_temp_state (fun path ->
      save_state path;
      let result = run_ta [ "--state"; path; "--height"; "0" ] in
      check_exit "exit" 2 result.status;
      Alcotest.(check bool)
        "height error" true
        (contains_substring ~needle:"--height must be positive" result.stderr))

let expect_tui_never_renders_static_dashboard () =
  with_temp_state (fun path ->
      save_state path;
      let result =
        run_ta [ "--state"; path; "--tui"; "never"; "--width"; "92" ]
      in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      Alcotest.(check bool)
        "dashboard header" true
        (contains_substring ~needle:"TA Dashboard" result.stdout))

let expect_tui_always_requires_terminal () =
  with_temp_state (fun path ->
      save_state path;
      let result = run_ta [ "--state"; path; "--tui"; "always" ] in
      check_exit "exit" 2 result.status;
      Alcotest.(check bool)
        "tui error" true
        (contains_substring
           ~needle:"--tui=always requires stdin and stdout to be terminals"
           result.stderr))

let expect_miaou_headless_tui_renders_dashboard () =
  with_temp_state (fun path ->
      save_state path;
      let result =
        run_ta_with_input
          ~env:[ ("MIAOU_DRIVER", "headless") ]
          ~stdin:"{\"cmd\":\"render\"}\n{\"cmd\":\"key\",\"key\":\"q\"}\n"
          [ "--state"; path; "--tui"; "always" ]
      in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      Alcotest.(check bool)
        "json frame" true
        (contains_substring ~needle:"\"type\":\"frame\"" result.stdout);
      Alcotest.(check bool)
        "dashboard header" true
        (contains_substring ~needle:"TA Dashboard" result.stdout);
      Alcotest.(check bool)
        "layout sidebar" true
        (contains_substring ~needle:"Workspaces" result.stdout);
      Alcotest.(check bool)
        "agent detail" true
        (contains_substring ~needle:"Agent fixture/lead" result.stdout))

let expect_no_defaults_prints_quickstart () =
  with_temp_workspace (fun dir ->
      with_chdir dir (fun () ->
          let result = run_ta [] in
          check_exit "exit" 0 result.status;
          Alcotest.(check string) "stderr" "" result.stderr;
          Alcotest.(check bool)
            "quickstart" true
            (contains_substring ~needle:"TA quickstart" result.stdout);
          Alcotest.(check bool)
            "entrypoint" true
            (contains_substring ~needle:"dune exec ta" result.stdout);
          Alcotest.(check bool)
            "default config" true
            (contains_substring ~needle:".harness/ta.json" result.stdout)))

let expect_default_config_renders_dashboard () =
  with_temp_workspace (fun dir ->
      write_default_config dir;
      with_chdir dir (fun () ->
          let result = run_ta [ "--width"; "92" ] in
          check_exit "exit" 0 result.status;
          Alcotest.(check string) "stderr" "" result.stderr;
          Alcotest.(check bool)
            "dashboard header" true
            (contains_substring ~needle:"TA Dashboard" result.stdout);
          Alcotest.(check bool)
            "workspace" true
            (contains_substring ~needle:"fixture" result.stdout);
          Alcotest.(check bool)
            "config pane state" true
            (contains_substring ~needle:"DETACHED" result.stdout)))

let expect_source_tree_example_renders_dashboard () =
  with_temp_workspace (fun dir ->
      write_source_tree_example_config dir;
      with_chdir dir (fun () ->
          let result = run_ta [ "--width"; "92" ] in
          check_exit "exit" 0 result.status;
          Alcotest.(check string) "stderr" "" result.stderr;
          Alcotest.(check bool)
            "dashboard header" true
            (contains_substring ~needle:"TA Dashboard" result.stdout);
          Alcotest.(check bool)
            "example workspace" true
            (contains_substring ~needle:"fixture" result.stdout);
          Alcotest.(check bool)
            "example agent" true
            (contains_substring ~needle:"lead" result.stdout)))

let expect_help_documents_startup () =
  let result = run_ta [ "--help=plain" ] in
  check_exit "exit" 0 result.status;
  Alcotest.(check string) "stderr" "" result.stderr;
  Alcotest.(check bool)
    "default startup section" true
    (contains_substring ~needle:"DEFAULT STARTUP" result.stdout);
  Alcotest.(check bool)
    "source command" true
    (contains_substring ~needle:"dune exec ta" result.stdout);
  Alcotest.(check bool)
    "tui status" true
    (contains_substring ~needle:"MIAOU terminal runner" result.stdout);
  Alcotest.(check bool)
    "tui option" true
    (contains_substring ~needle:"--tui=MODE" result.stdout);
  Alcotest.(check bool)
    "headless documented" true
    (contains_substring ~needle:"MIAOU_DRIVER=headless" result.stdout)

let () =
  Alcotest.run "ta-cli"
    [
      ( "startup",
        [
          Alcotest.test_case "no defaults prints quickstart" `Quick
            expect_no_defaults_prints_quickstart;
          Alcotest.test_case "default config renders dashboard" `Quick
            expect_default_config_renders_dashboard;
          Alcotest.test_case "source tree example renders dashboard" `Quick
            expect_source_tree_example_renders_dashboard;
          Alcotest.test_case "help documents startup" `Quick
            expect_help_documents_startup;
        ] );
      ( "dashboard",
        [
          Alcotest.test_case "state dashboard" `Quick expect_state_dashboard;
          Alcotest.test_case "state dashboard replays key" `Quick
            expect_state_dashboard_replays_key;
          Alcotest.test_case "state dashboard respects height" `Quick
            expect_state_dashboard_respects_height;
          Alcotest.test_case "rejects bad width" `Quick expect_rejects_bad_width;
          Alcotest.test_case "rejects bad height" `Quick
            expect_rejects_bad_height;
          Alcotest.test_case "tui never renders static dashboard" `Quick
            expect_tui_never_renders_static_dashboard;
          Alcotest.test_case "tui always requires terminal" `Quick
            expect_tui_always_requires_terminal;
          Alcotest.test_case "miaou headless tui renders dashboard" `Quick
            expect_miaou_headless_tui_renders_dashboard;
        ] );
    ]
