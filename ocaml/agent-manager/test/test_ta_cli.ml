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

let index_of_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then None
    else if String.sub value idx needle_len = needle then Some idx
    else loop (idx + 1)
  in
  if String.equal needle "" then Some 0 else loop 0

let check_ordered_substrings label needles value =
  let rec loop previous = function
    | [] -> ()
    | needle :: rest -> (
        match index_of_substring ~needle value with
        | None -> Alcotest.failf "%s: missing %S" label needle
        | Some index ->
            Alcotest.(check bool)
              (label ^ ": " ^ needle)
              true (index > previous);
            loop index rest)
  in
  loop (-1) needles

let line_count value =
  let lines = String.split_on_char '\n' value in
  match List.rev lines with
  | "" :: rest -> List.length rest
  | _ -> List.length lines

let last_text_line value =
  value |> String.split_on_char '\n'
  |> List.filter (fun line -> not (String.equal line ""))
  |> List.rev |> function
  | line :: _ -> line
  | [] -> ""

type frame = { frame_text : string; frame_rows : int; frame_cols : int }

let frame_field_string name fields =
  match List.assoc_opt name fields with
  | Some (`String value) -> Some value
  | _ -> None

let frame_field_int name fields =
  match List.assoc_opt name fields with
  | Some (`Int value) -> Some value
  | _ -> None

let decode_frame = function
  | `Assoc fields when frame_field_string "type" fields = Some "frame" -> (
      match
        ( frame_field_string "text" fields,
          frame_field_int "rows" fields,
          frame_field_int "cols" fields )
      with
      | Some frame_text, Some frame_rows, Some frame_cols ->
          Some { frame_text; frame_rows; frame_cols }
      | _ -> None)
  | _ -> None

let frame_outputs stdout =
  stdout |> String.split_on_char '\n'
  |> List.filter_map (fun line ->
      let line = String.trim line in
      if String.equal line "" then None
      else
        try decode_frame (Yojson.Safe.from_string line)
        with Yojson.Json_error _ -> None)

let last_frame stdout =
  match List.rev (frame_outputs stdout) with
  | frame :: _ -> frame
  | [] -> Alcotest.fail "expected at least one headless frame"

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
      remove_noerr (Filename.concat path ".ta-state.json.lock");
      remove_noerr (Filename.concat path "ta.json");
      remove_noerr
        (Filename.concat path "ocaml/agent-manager/examples/ta.example.json");
      remove_noerr (Filename.concat path "examples/ta.example.json");
      remove_noerr (Filename.concat path ".harness/harness.json");
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

let write_harness_config dir =
  let harness = Filename.concat dir ".harness" in
  mkdir_noerr harness 0o700;
  write_file
    (Filename.concat harness "harness.json")
    {|
{
  "version": "1.0.0",
  "project": {
    "name": "agent-roster"
  },
  "layers": {
    "agents": [
      {
        "name": "qa",
        "role": "Runs deterministic checks."
      },
      {
        "name": "tech-lead",
        "role": "Owns roadmap, review, QA, commits, and pushes."
      }
    ]
  }
}
|}

let write_invalid_harness_config dir =
  let harness = Filename.concat dir ".harness" in
  mkdir_noerr harness 0o700;
  write_file (Filename.concat harness "harness.json") "{ invalid harness"

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

let save_state_from_string path text =
  match Ta_core.Workspace_config.parse_string text with
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

let kill_tmux_session session =
  ignore
    (Ta_core.Tmux.run
       (Ta_core.Tmux.Kill_session (Ta_core.Tmux.unsafe_session_of_string session)))

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
        "launch command" true
        (contains_substring ~needle:"Launch: 'codex'" result.stdout);
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
          ~stdin:
            "{\"cmd\":\"render\"}\n\
             {\"cmd\":\"key\",\"key\":\"p\"}\n\
             {\"cmd\":\"key\",\"key\":\"Right\"}\n\
             {\"cmd\":\"key\",\"key\":\"q\"}\n"
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
        "launch summary" true
        (contains_substring ~needle:"Workspace     fixture | Fixture"
           result.stdout);
      Alcotest.(check bool)
        "selected launch agent" true
        (contains_substring ~needle:"Agent         lead" result.stdout);
      Alcotest.(check bool)
        "launch roster" true
        (contains_substring ~needle:"Roster        tech-lead" result.stdout);
      Alcotest.(check bool)
        "agent table shows launch profile" true
        (contains_substring ~needle:"│ lead   │ Codex"
           result.stdout);
      Alcotest.(check bool)
        "agent table keeps profile picker compact" false
        (contains_substring ~needle:"│ Profile  │ Status"
           result.stdout);
      Alcotest.(check bool)
        "start action" true
        (contains_substring
           ~needle:"Launch fixture/lead | Codex | 'codex' | Enter Start"
           result.stdout);
      Alcotest.(check bool)
        "launch detail" true
        (contains_substring ~needle:"★ Launch" result.stdout);
      check_ordered_substrings "compact launch detail"
        [ "Workspace"; "Agent"; "Roster"; "Profile"; "Authority"; "Access" ]
        result.stdout;
      Alcotest.(check bool)
        "launch command detail" true
        (contains_substring ~needle:"'codex'" result.stdout);
      Alcotest.(check bool)
        "pipeline edge" true
        (contains_substring ~needle:"Pipeline edge" result.stdout))

let expect_miaou_headless_launcher_axes_and_footer () =
  with_temp_state (fun path ->
      save_state_from_string path
        {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "fixture",
      "label": "Fixture",
      "root": ".",
      "tmux_session": "ta-fixture",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]}
      ]
    },
    {
      "id": "docs",
      "label": "Docs",
      "root": ".",
      "tmux_session": "ta-docs",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {"name": "writer", "roster_agent": "documenter", "command": ["codex"]},
        {"name": "editor", "roster_agent": "reviewer", "command": ["sh", "-lc", "printf editor-ready"]},
        {"name": "custom", "roster_agent": "reviewer", "command": ["very-long-custom-runtime-name"]}
      ]
    }
  ]
}
|};
      let result =
        run_ta_with_input
          ~env:[ ("MIAOU_DRIVER", "headless") ]
          ~stdin:
            "{\"cmd\":\"resize\",\"rows\":18,\"cols\":92}\n\
             {\"cmd\":\"key\",\"key\":\"Right\"}\n\
             {\"cmd\":\"key\",\"key\":\"Down\"}\n\
             {\"cmd\":\"render\"}\n\
             {\"cmd\":\"quit\"}\n"
          [ "--state"; path; "--tui"; "always" ]
      in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      let frame = last_frame result.stdout in
      Alcotest.(check bool)
        "right selects workspace" true
        (contains_substring ~needle:"Workspace     docs | Docs"
           frame.frame_text);
      Alcotest.(check bool)
        "down selects agent" true
        (contains_substring ~needle:"Agent         editor" frame.frame_text);
      Alcotest.(check bool)
        "agent table exposes selected profile" true
        (contains_substring ~needle:"│ editor"
           frame.frame_text
        && contains_substring ~needle:"│ shell"
           frame.frame_text);
      Alcotest.(check bool)
        "agent table caps long profile labels" true
        (contains_substring ~needle:"very-long..."
           frame.frame_text);
      Alcotest.(check bool)
        "agent table hides uncapped custom profile" false
        (contains_substring ~needle:"very-long-custom-runtime-name"
           frame.frame_text);
      Alcotest.(check bool)
        "detached launcher hides empty preview" false
        (contains_substring ~needle:"no pane output captured" frame.frame_text);
      Alcotest.(check bool)
        "launcher footer" true
        (contains_substring
           ~needle:"Launch docs/editor | shell | 'sh' '-lc' 'printf editor-ready' | Enter Start"
           (last_text_line frame.frame_text));
      Alcotest.(check int) "frame rows" 18 frame.frame_rows;
      Alcotest.(check bool)
        "frame fits terminal height" true
        (line_count frame.frame_text <= frame.frame_rows))

let expect_miaou_headless_launcher_footer_pinned_when_tiny () =
  with_temp_state (fun path ->
      save_state_from_string path
        {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "fixture",
      "label": "Fixture",
      "root": ".",
      "tmux_session": "ta-fixture",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]}
      ]
    },
    {
      "id": "docs",
      "label": "Docs",
      "root": ".",
      "tmux_session": "ta-docs",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {"name": "writer", "roster_agent": "documenter", "command": ["codex"]}
      ]
    }
  ]
}
|};
      let result =
        run_ta_with_input
          ~env:[ ("MIAOU_DRIVER", "headless") ]
          ~stdin:
            "{\"cmd\":\"resize\",\"rows\":5,\"cols\":80}\n\
             {\"cmd\":\"key\",\"key\":\"Right\"}\n\
             {\"cmd\":\"render\"}\n\
             {\"cmd\":\"quit\"}\n"
          [ "--state"; path; "--tui"; "always" ]
      in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      let frame = last_frame result.stdout in
      Alcotest.(check int) "frame rows" 5 frame.frame_rows;
      Alcotest.(check int)
        "frame fills tiny height" frame.frame_rows (line_count frame.frame_text);
      Alcotest.(check bool)
        "tiny launcher footer" true
        (contains_substring
           ~needle:"Launch docs/writer | Codex | 'codex' | Enter Start"
           frame.frame_text);
      Alcotest.(check bool)
        "last line is footer" true
        (contains_substring
           ~needle:"Launch docs/writer | Codex | 'codex' | Enter Start"
           (last_text_line frame.frame_text)))

let expect_miaou_headless_tui_respects_short_height () =
  with_temp_state (fun path ->
      save_state path;
      let result =
        run_ta_with_input
          ~env:[ ("MIAOU_DRIVER", "headless") ]
          ~stdin:
            "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
             {\"cmd\":\"tick\",\"n\":1}\n\
             {\"cmd\":\"quit\"}\n"
          [ "--state"; path; "--tui"; "always" ]
      in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      let frame = last_frame result.stdout in
      Alcotest.(check int) "frame rows" 10 frame.frame_rows;
      Alcotest.(check int) "frame cols" 80 frame.frame_cols;
      Alcotest.(check bool)
        "frame fits terminal height" true
        (line_count frame.frame_text <= frame.frame_rows);
      Alcotest.(check bool)
        "launch summary remains visible" true
        (contains_substring ~needle:"Workspace     fixture | Fixture"
           frame.frame_text))

let expect_miaou_headless_tui_uses_full_collapsed_width () =
  with_temp_state (fun path ->
      save_state path;
      let result =
        run_ta_with_input
          ~env:[ ("MIAOU_DRIVER", "headless") ]
          ~stdin:
            "{\"cmd\":\"resize\",\"rows\":18,\"cols\":39}\n\
             {\"cmd\":\"tick\",\"n\":1}\n\
             {\"cmd\":\"quit\"}\n"
          [ "--state"; path; "--tui"; "always" ]
      in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      let frame = last_frame result.stdout in
      Alcotest.(check int) "frame cols" 39 frame.frame_cols;
      Alcotest.(check bool)
        "collapsed view uses full width" true
        (contains_substring ~needle:"Roster        tech-lead"
           frame.frame_text);
      Alcotest.(check bool)
        "collapsed action remains visible" true
        (contains_substring ~needle:"Launch lead | Codex | Enter Start"
           frame.frame_text))

let expect_miaou_headless_tui_enter_without_socket_marks_stale () =
  with_temp_workspace (fun dir ->
      let state_path = Filename.concat dir ".ta-state.json" in
      save_state state_path;
      with_chdir dir (fun () ->
          let result =
            run_ta_with_input
              ~env:[ ("MIAOU_DRIVER", "headless") ]
              ~stdin:
                "{\"cmd\":\"key\",\"key\":\"Enter\"}\n\
                 {\"cmd\":\"render\"}\n\
                 {\"cmd\":\"quit\"}\n"
              [ "--state"; state_path; "--tui"; "always" ]
          in
          check_exit "exit" 0 result.status;
          Alcotest.(check string) "stderr" "" result.stderr;
          let frame = last_frame result.stdout in
          Alcotest.(check bool)
            "stale start failure" true
            (contains_substring
               ~needle:"stale: start-agent requires --socket or a config"
               frame.frame_text)))

let expect_miaou_headless_tui_enter_aliases_start () =
  List.iter
    (fun key ->
      with_temp_workspace (fun dir ->
          let state_path = Filename.concat dir ".ta-state.json" in
          save_state state_path;
          with_chdir dir (fun () ->
              let result =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    (Printf.sprintf
                       "{\"cmd\":\"key\",\"key\":%S}\n\
                        {\"cmd\":\"render\"}\n\
                        {\"cmd\":\"quit\"}\n"
                       key)
                  [ "--state"; state_path; "--tui"; "always" ]
              in
              check_exit (key ^ " exit") 0 result.status;
              Alcotest.(check string) (key ^ " stderr") "" result.stderr;
              let frame = last_frame result.stdout in
              Alcotest.(check bool)
                (key ^ " start failure")
                true
                (contains_substring
                   ~needle:"stale: start-agent requires --socket or a config"
                   frame.frame_text))))
    [ "Return"; "C-m" ]

let save_attached_state path =
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
          let workspace = Ta_core.Id.Workspace.unsafe_of_string "fixture" in
          let agent = Ta_core.Id.Agent.unsafe_of_string "lead" in
          let pane = Ta_core.Id.Pane.unsafe_of_string "%77" in
          match
            Ta_core.State_store.attach_pane store ~workspace ~agent ~pane
              ~actor:None
          with
          | Error message -> Alcotest.fail message
          | Ok store -> (
              match Ta_core.State_file.save ~path store with
              | Ok () -> ()
              | Error error ->
                  Alcotest.fail
                    (Ta_core.State_file.error_to_string error))))

let expect_miaou_headless_tui_enter_refreshes_attached_agent () =
  with_temp_workspace (fun dir ->
      let state_path = Filename.concat dir ".ta-state.json" in
      save_attached_state state_path;
      with_chdir dir (fun () ->
          let result =
            run_ta_with_input
              ~env:[ ("MIAOU_DRIVER", "headless") ]
              ~stdin:
                "{\"cmd\":\"key\",\"key\":\"Enter\"}\n\
                 {\"cmd\":\"render\"}\n\
                 {\"cmd\":\"quit\"}\n"
              [ "--state"; state_path; "--tui"; "always" ]
          in
          check_exit "exit" 0 result.status;
          Alcotest.(check string) "stderr" "" result.stderr;
          let frame = last_frame result.stdout in
          Alcotest.(check bool)
            "attached primary action" true
            (contains_substring ~needle:"Enter Refresh | attached"
               frame.frame_text);
          check_ordered_substrings "attached stale layout"
            [ "Preview"; "Agent detail"; "Pane          %77"; "Enter Refresh" ]
            frame.frame_text;
          Alcotest.(check bool)
            "attached stale does not show detached launch panel" false
            (contains_substring ~needle:"★ Launch" frame.frame_text);
          Alcotest.(check bool)
            "attached footer action is complete" true
            (contains_substring ~needle:"Enter Refresh"
               (last_text_line frame.frame_text));
          Alcotest.(check bool)
            "attached footer action is not truncated" false
            (contains_substring ~needle:"Enter Ref..."
               (last_text_line frame.frame_text));
          Alcotest.(check bool)
            "enter did not try start without config" false
            (contains_substring ~needle:"start-agent requires --socket"
               frame.frame_text)))

let expect_miaou_headless_tui_s_rejects_attached_start () =
  with_temp_workspace (fun dir ->
      let state_path = Filename.concat dir ".ta-state.json" in
      save_attached_state state_path;
      with_chdir dir (fun () ->
          let result =
            run_ta_with_input
              ~env:[ ("MIAOU_DRIVER", "headless") ]
              ~stdin:
                "{\"cmd\":\"key\",\"key\":\"s\"}\n\
                 {\"cmd\":\"render\"}\n\
                 {\"cmd\":\"quit\"}\n"
              [ "--state"; state_path; "--tui"; "always" ]
          in
          check_exit "exit" 0 result.status;
          Alcotest.(check string) "stderr" "" result.stderr;
          let frame = last_frame result.stdout in
          Alcotest.(check bool)
            "attached start guard" true
            (contains_substring
               ~needle:"selected agent is already attached"
               frame.frame_text);
          Alcotest.(check bool)
            "s did not try start without config" false
            (contains_substring ~needle:"start-agent requires --socket"
               frame.frame_text)))

let expect_miaou_headless_tui_direct_start_with_config () =
  with_temp_workspace (fun dir ->
      let session =
        Printf.sprintf "ta-loop40-direct-%d" (Unix.getpid ())
      in
      let config_path = Filename.concat dir "ta.json" in
      let state_path = Filename.concat dir ".ta-state.json" in
      write_file config_path
        (Printf.sprintf
           {|{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "smoke",
      "label": "Smoke",
      "root": ".",
      "tmux_session": "%s",
      "default_view": "agents",
      "views": [{ "id": "agents", "label": "Agents" }],
      "agents": [
        {
          "name": "lead",
          "roster_agent": "tech-lead",
          "command": ["sh", "-lc", "printf direct-start-ready; sleep 60"]
        }
      ],
      "links": []
    }
  ]
}|}
           session);
      Fun.protect
        ~finally:(fun () -> kill_tmux_session session)
        (fun () ->
          with_chdir dir (fun () ->
              let result =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"key\",\"key\":\"Enter\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--config";
                    config_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "exit" 0 result.status;
              Alcotest.(check string) "stderr" "" result.stderr;
              Alcotest.(check bool)
                "state bootstrapped" true
                (Sys.file_exists state_path);
              let frame = last_frame result.stdout in
              Alcotest.(check bool)
                "live runtime" true
                (contains_substring ~needle:"Runtime       LIVE"
                   frame.frame_text);
              Alcotest.(check bool)
                "running status" true
                (contains_substring ~needle:"Status        running"
                   frame.frame_text);
              Alcotest.(check bool)
                "attached action" true
                (contains_substring ~needle:"Enter Refresh | attached"
                   frame.frame_text))))

let expect_miaou_headless_live_preview_is_visible_when_short () =
  with_temp_workspace (fun dir ->
      let session =
        Printf.sprintf "ta-loop46-live-preview-%d" (Unix.getpid ())
      in
      let state_path = Filename.concat dir ".ta-state.json" in
      let tmux_session = Ta_core.Tmux.unsafe_session_of_string session in
      let preview_command =
        "printf \
         'direct-start-ready\\nfocus-line-2\\nfocus-line-3\\nfocus-line-4\\nfocus-line-5\\nfocus-line-6\\nfocus-line-7\\nfocus-line-8\\nfocus-line-9\\nfocus-line-10\\n'; \
         sleep 60"
      in
      let config_text =
        Printf.sprintf
          {|{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "smoke",
      "label": "Smoke",
      "root": ".",
      "tmux_session": "%s",
      "default_view": "agents",
      "views": [{ "id": "agents", "label": "Agents" }],
      "agents": [
        {
          "name": "lead",
          "roster_agent": "tech-lead",
          "command": ["sh", "-lc", "printf direct-start-ready; sleep 60"]
        },
        {
          "name": "qa",
          "roster_agent": "qa",
          "command": ["sh", "-lc", "printf qa-ready; sleep 60"]
        }
      ],
      "links": []
    }
  ]
}|}
          session
      in
      Fun.protect
        ~finally:(fun () -> kill_tmux_session session)
        (fun () ->
          let pane =
            match
              Ta_core.Tmux.run
                (Ta_core.Tmux.New_detached_session_with_pane_id
                   {
                     session = tmux_session;
                     cwd = Some dir;
                     command =
                       [
                         "sh"; "-lc"; preview_command;
                       ];
                   })
            with
            | Ok output -> Ta_core.Id.Pane.unsafe_of_string (String.trim output)
            | Error error ->
                Alcotest.fail (Ta_core.Tmux.error_to_string error)
          in
          Unix.sleepf 0.2;
          let identity =
            match
              Ta_core.Tmux.run
                (Ta_core.Tmux.Display_pane_identity
                   (Ta_core.Tmux.unsafe_target_of_string
                      (Ta_core.Id.Pane.to_string pane)))
            with
            | Ok output -> (
                match Ta_core.Tmux.parse_pane_identity output with
                | Ok identity -> identity
                | Error message -> Alcotest.fail message)
            | Error error ->
                Alcotest.fail (Ta_core.Tmux.error_to_string error)
          in
          let store =
            match Ta_core.Workspace_config.parse_string config_text with
            | Error errors ->
                Alcotest.fail
                  (String.concat "\n"
                     (List.map Ta_core.Workspace_config.error_to_string
                        errors))
            | Ok config -> (
                match Ta_core.State_store.of_config config with
                | Error errors ->
                    Alcotest.fail
                      (String.concat "\n"
                         (List.map Ta_core.Workspace_config.error_to_string
                            errors))
                | Ok store ->
                    let workspace =
                      Ta_core.Id.Workspace.unsafe_of_string "smoke"
                    in
                    let agent = Ta_core.Id.Agent.unsafe_of_string "lead" in
                    let store =
                      match
                        Ta_core.State_store.set_agent_status store ~workspace
                          ~agent ~status:Ta_core.State_store.Running
                          ~actor:None
                      with
                      | Ok store -> store
                      | Error message -> Alcotest.fail message
                    in
                    match
                      Ta_core.State_store.attach_pane store ~identity
                        ~workspace ~agent ~pane ~actor:None
                    with
                    | Ok store -> store
                    | Error message -> Alcotest.fail message)
          in
          (match Ta_core.State_file.save ~path:state_path store with
          | Ok () -> ()
          | Error error ->
              Alcotest.fail (Ta_core.State_file.error_to_string error));
          with_chdir dir (fun () ->
              let result =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
                     {\"cmd\":\"key\",\"key\":\"Enter\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--lines";
                    "1";
                    "--state";
                    state_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "exit" 0 result.status;
              Alcotest.(check string) "stderr" "" result.stderr;
              let frame = last_frame result.stdout in
              Alcotest.(check int) "frame rows" 10 frame.frame_rows;
              Alcotest.(check bool)
                "frame fits terminal height" true
                (line_count frame.frame_text <= frame.frame_rows);
              Alcotest.(check bool)
                "live preview visible" true
                (contains_substring ~needle:"direct-start-ready"
                   frame.frame_text);
              Alcotest.(check bool)
                "attached action visible" true
                (contains_substring ~needle:"Enter Refresh"
                   frame.frame_text);
              check_ordered_substrings "live layout order"
                [
                  "Preview";
                  "direct-start-ready";
                  "Agent detail";
                  "Enter Refresh";
                ]
                frame.frame_text;
              let focused =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
                     {\"cmd\":\"key\",\"key\":\"v\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--lines";
                    "1";
                    "--state";
                    state_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "focus exit" 0 focused.status;
              Alcotest.(check string) "focus stderr" "" focused.stderr;
              let focused_frame = last_frame focused.stdout in
              Alcotest.(check int) "focus frame rows" 10 focused_frame.frame_rows;
              Alcotest.(check bool)
                "focused frame fits terminal height" true
                (line_count focused_frame.frame_text
                <= focused_frame.frame_rows);
              Alcotest.(check bool)
                "focused preview title" true
                (contains_substring ~needle:"Preview smoke/lead"
                   focused_frame.frame_text);
              Alcotest.(check bool)
                "focused live preview visible" true
                (contains_substring ~needle:"direct-start-ready"
                   focused_frame.frame_text);
              Alcotest.(check bool)
                "focused preview hides sidebar" false
                (contains_substring ~needle:"Workspaces"
                   focused_frame.frame_text);
              Alcotest.(check bool)
                "focused preview hides detail" false
                (contains_substring ~needle:"Agent detail"
                   focused_frame.frame_text);
              let refreshed_focus =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
                     {\"cmd\":\"key\",\"key\":\"v\"}\n\
                     {\"cmd\":\"key\",\"key\":\"r\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--lines";
                    "1";
                    "--state";
                    state_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "refreshed focus exit" 0 refreshed_focus.status;
              Alcotest.(check string)
                "refreshed focus stderr" "" refreshed_focus.stderr;
              let refreshed_focus_frame =
                last_frame refreshed_focus.stdout
              in
              Alcotest.(check bool)
                "refresh keeps focused preview" true
                (contains_substring ~needle:"Preview smoke/lead"
                   refreshed_focus_frame.frame_text);
              Alcotest.(check bool)
                "refreshed focus hides sidebar" false
                (contains_substring ~needle:"Workspaces"
                   refreshed_focus_frame.frame_text);
              let noop_view_key_focus =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
                     {\"cmd\":\"key\",\"key\":\"v\"}\n\
                     {\"cmd\":\"key\",\"key\":\"a\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--lines";
                    "1";
                    "--state";
                    state_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "noop view key focus exit" 0
                noop_view_key_focus.status;
              Alcotest.(check string)
                "noop view key focus stderr" "" noop_view_key_focus.stderr;
              let noop_view_key_focus_frame =
                last_frame noop_view_key_focus.stdout
              in
              Alcotest.(check bool)
                "noop view key keeps focus" true
                (contains_substring ~needle:"Preview smoke/lead"
                   noop_view_key_focus_frame.frame_text);
              Alcotest.(check bool)
                "noop view key still hides sidebar" false
                (contains_substring ~needle:"Workspaces"
                   noop_view_key_focus_frame.frame_text);
              let moved_from_focus =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
                     {\"cmd\":\"key\",\"key\":\"v\"}\n\
                     {\"cmd\":\"key\",\"key\":\"Down\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--lines";
                    "1";
                    "--state";
                    state_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "moved focus exit" 0 moved_from_focus.status;
              Alcotest.(check string)
                "moved focus stderr" "" moved_from_focus.stderr;
              let moved_focus_frame = last_frame moved_from_focus.stdout in
              Alcotest.(check bool)
                "move clears focused title" false
                (contains_substring ~needle:"Preview smoke/lead"
                   moved_focus_frame.frame_text);
              Alcotest.(check bool)
                "move restores sidebar" true
                (contains_substring ~needle:"Workspaces"
                   moved_focus_frame.frame_text);
              Alcotest.(check bool)
                "move restores launch summary" true
                (contains_substring ~needle:"Agent         qa"
                   moved_focus_frame.frame_text);
              Alcotest.(check bool)
                "move selects qa" true
                (contains_substring ~needle:"smoke/qa"
                   moved_focus_frame.frame_text);
              let returned_after_move =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
                     {\"cmd\":\"key\",\"key\":\"v\"}\n\
                     {\"cmd\":\"key\",\"key\":\"Down\"}\n\
                     {\"cmd\":\"key\",\"key\":\"Up\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--lines";
                    "1";
                    "--state";
                    state_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "returned after move exit" 0
                returned_after_move.status;
              Alcotest.(check string)
                "returned after move stderr" "" returned_after_move.stderr;
              let returned_after_move_frame =
                last_frame returned_after_move.stdout
              in
              Alcotest.(check bool)
                "return does not restore stale focus" false
                (contains_substring ~needle:"Preview smoke/lead"
                   returned_after_move_frame.frame_text);
              Alcotest.(check bool)
                "return restores normal detail" true
                (contains_substring ~needle:"Agent detail"
                   returned_after_move_frame.frame_text);
              let detached_focus_does_not_arm =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
                     {\"cmd\":\"key\",\"key\":\"Down\"}\n\
                     {\"cmd\":\"key\",\"key\":\"v\"}\n\
                     {\"cmd\":\"key\",\"key\":\"Up\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--lines";
                    "1";
                    "--state";
                    state_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "detached focus does not arm exit" 0
                detached_focus_does_not_arm.status;
              Alcotest.(check string)
                "detached focus does not arm stderr" ""
                detached_focus_does_not_arm.stderr;
              let detached_focus_frame =
                last_frame detached_focus_does_not_arm.stdout
              in
              Alcotest.(check bool)
                "detached v does not arm later live focus" false
                (contains_substring ~needle:"Preview smoke/lead"
                   detached_focus_frame.frame_text);
              Alcotest.(check bool)
                "detached v returns normal sidebar" true
                (contains_substring ~needle:"Workspaces"
                   detached_focus_frame.frame_text);
              Alcotest.(check bool)
                "detached v returns normal detail" true
                (contains_substring ~needle:"Agent detail"
                   detached_focus_frame.frame_text);
              let pipeline_after_focus =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
                     {\"cmd\":\"key\",\"key\":\"v\"}\n\
                     {\"cmd\":\"key\",\"key\":\"p\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--lines";
                    "1";
                    "--state";
                    state_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "pipeline after focus exit" 0
                pipeline_after_focus.status;
              Alcotest.(check string)
                "pipeline after focus stderr" "" pipeline_after_focus.stderr;
              let pipeline_after_focus_frame =
                last_frame pipeline_after_focus.stdout
              in
              Alcotest.(check bool)
                "pipeline key clears preview focus" true
                (contains_substring ~needle:"Select an ACL edge"
                   pipeline_after_focus_frame.frame_text);
              Alcotest.(check bool)
                "pipeline key hides focused title" false
                (contains_substring ~needle:"Preview smoke/lead"
                   pipeline_after_focus_frame.frame_text);
              let focused_from_pipeline =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"resize\",\"rows\":10,\"cols\":80}\n\
                     {\"cmd\":\"key\",\"key\":\"p\"}\n\
                     {\"cmd\":\"key\",\"key\":\"v\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--state";
                    state_path;
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "pipeline focus exit" 0 focused_from_pipeline.status;
              Alcotest.(check string)
                "pipeline focus stderr" "" focused_from_pipeline.stderr;
              let pipeline_frame = last_frame focused_from_pipeline.stdout in
              Alcotest.(check int)
                "pipeline focus frame rows" 10 pipeline_frame.frame_rows;
              Alcotest.(check int)
                "pipeline focus line count" 10
                (line_count pipeline_frame.frame_text);
              Alcotest.(check bool)
                "pipeline focus preview title" true
                (contains_substring ~needle:"Preview smoke/lead"
                   pipeline_frame.frame_text);
              Alcotest.(check bool)
                "pipeline focus live output" true
                (contains_substring ~needle:"direct-start-ready"
                   pipeline_frame.frame_text);
              Alcotest.(check bool)
                "pipeline focus hides pipeline content" false
                (contains_substring ~needle:"Pipeline overview"
                   pipeline_frame.frame_text))))

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
            (contains_substring ~needle:"DETACHED" result.stdout);
          Alcotest.(check bool)
            "state bootstrapped" true
            (Sys.file_exists ".ta-state.json")))

let expect_default_config_enter_starts_agent () =
  with_temp_workspace (fun dir ->
      let session =
        Printf.sprintf "ta-relative-default-%d" (Unix.getpid ())
      in
      let harness = Filename.concat dir ".harness" in
      mkdir_noerr harness 0o700;
      write_file
        (Filename.concat harness "ta.json")
        (Printf.sprintf
           {|{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "smoke",
      "label": "Smoke",
      "root": ".",
      "tmux_session": "%s",
      "default_view": "agents",
      "views": [{ "id": "agents", "label": "Agents" }],
      "agents": [
        {
          "name": "lead",
          "roster_agent": "tech-lead",
          "command": ["sh", "-lc", "printf default-start-ready; sleep 60"]
        }
      ],
      "links": []
    }
  ]
}|}
           session);
      Fun.protect
        ~finally:(fun () -> kill_tmux_session session)
        (fun () ->
          with_chdir dir (fun () ->
              let result =
                run_ta_with_input
                  ~env:[ ("MIAOU_DRIVER", "headless") ]
                  ~stdin:
                    "{\"cmd\":\"key\",\"key\":\"Enter\"}\n\
                     {\"cmd\":\"render\"}\n\
                     {\"cmd\":\"quit\"}\n"
                  [
                    "--workspace";
                    "smoke";
                    "--agent";
                    "lead";
                    "--tui";
                    "always";
                  ]
              in
              check_exit "exit" 0 result.status;
              Alcotest.(check string) "stderr" "" result.stderr;
              Alcotest.(check bool)
                "state bootstrapped" true
                (Sys.file_exists ".ta-state.json");
              let frame = last_frame result.stdout in
              Alcotest.(check bool)
                "attached action" true
                (contains_substring ~needle:"Enter Refresh | attached"
                   frame.frame_text))))

let expect_harness_config_generates_workspace_dashboard () =
  with_temp_workspace (fun dir ->
      write_harness_config dir;
      with_chdir dir (fun () ->
          let result =
            run_ta_with_input
              ~env:[ ("MIAOU_DRIVER", "headless") ]
              ~stdin:"{\"cmd\":\"render\"}\n{\"cmd\":\"quit\"}\n"
              [ "--tui"; "always" ]
          in
          check_exit "exit" 0 result.status;
          Alcotest.(check string) "stderr" "" result.stderr;
          let frame = last_frame result.stdout in
          Alcotest.(check bool)
            "dashboard header" true
            (contains_substring ~needle:"TA Dashboard" frame.frame_text);
          Alcotest.(check bool)
            "workspace" true
            (contains_substring ~needle:"agent-roster" frame.frame_text);
          Alcotest.(check bool)
            "tech lead selected" true
            (contains_substring ~needle:"Agent         tech-lead"
               frame.frame_text);
          Alcotest.(check bool)
            "start action" true
            (contains_substring ~needle:"Enter Start"
               (last_text_line frame.frame_text));
          Alcotest.(check bool)
            "sidebar omits duplicate start action" false
            (contains_substring ~needle:"Enter Start tech-lead"
               frame.frame_text);
          Alcotest.(check bool)
            "harness provenance" true
            (contains_substring
               ~needle:"Workspace     agent-roster | agent-roster | harn"
               frame.frame_text);
          Alcotest.(check bool)
            "visible access" true
            (contains_substring ~needle:"Access" frame.frame_text
            && contains_substring ~needle:"read qa | write qa"
                 frame.frame_text);
          Alcotest.(check bool)
            "visible authority" true
            (contains_substring ~needle:"Authority" frame.frame_text
            && contains_substring ~needle:"create+connect"
                 frame.frame_text);
          Alcotest.(check bool)
            "detached launch omits raw capabilities" false
            (contains_substring ~needle:"Capabilities" frame.frame_text);
          Alcotest.(check bool)
            "footer powers" true
            (contains_substring
               ~needle:
                 "Launch agent-roster/tech-lead | Authority create+connect | \
                  Codex | Enter Start"
               (last_text_line frame.frame_text));
          Alcotest.(check bool)
            "footer action is complete" false
            (contains_substring ~needle:"Enter Star..."
               (last_text_line frame.frame_text));
          Alcotest.(check bool)
            "config generated" true
            (Sys.file_exists ".harness/ta.json");
          Alcotest.(check bool)
            "state bootstrapped" true
            (Sys.file_exists ".ta-state.json");
          let qa_result =
            run_ta_with_input
              ~env:[ ("MIAOU_DRIVER", "headless") ]
              ~stdin:"{\"cmd\":\"render\"}\n{\"cmd\":\"quit\"}\n"
              [ "--agent"; "qa"; "--tui"; "always" ]
          in
          check_exit "qa exit" 0 qa_result.status;
          Alcotest.(check string) "qa stderr" "" qa_result.stderr;
          let qa_frame = last_frame qa_result.stdout in
          Alcotest.(check bool)
            "qa selected" true
            (contains_substring ~needle:"Agent         qa"
               qa_frame.frame_text);
          Alcotest.(check bool)
            "qa standard authority" true
            (contains_substring ~needle:"Authority" qa_frame.frame_text
            && contains_substring ~needle:"standard" qa_frame.frame_text);
          Alcotest.(check bool)
            "qa self-only access" true
            (contains_substring ~needle:"Access" qa_frame.frame_text
            && contains_substring ~needle:"self only" qa_frame.frame_text);
          Alcotest.(check bool)
            "qa footer has no powers" false
            (contains_substring ~needle:"Authority create+connect"
               (last_text_line qa_frame.frame_text))))

let expect_ta_config_wins_over_harness_config () =
  with_temp_workspace (fun dir ->
      write_default_config dir;
      write_harness_config dir;
      with_chdir dir (fun () ->
          let result = run_ta [ "--width"; "92" ] in
          check_exit "exit" 0 result.status;
          Alcotest.(check string) "stderr" "" result.stderr;
          Alcotest.(check bool)
            "ta config workspace wins" true
            (contains_substring ~needle:"fixture" result.stdout);
          Alcotest.(check bool)
            "harness workspace not selected" false
            (contains_substring ~needle:"agent-roster" result.stdout)))

let expect_invalid_harness_config_does_not_fall_back_to_examples () =
  with_temp_workspace (fun dir ->
      write_invalid_harness_config dir;
      write_source_tree_example_config dir;
      with_chdir dir (fun () ->
          let result = run_ta [] in
          check_exit "exit" 1 result.status;
          Alcotest.(check bool)
            "invalid harness error" true
            (contains_substring ~needle:"invalid JSON" result.stderr);
          Alcotest.(check string) "stdout" "" result.stdout;
          Alcotest.(check bool)
            "no generated config" false
            (Sys.file_exists ".harness/ta.json");
          Alcotest.(check bool)
            "no generated state" false
            (Sys.file_exists ".ta-state.json")))

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
    "normal flow" true
    (contains_substring ~needle:"NORMAL TUI FLOW" result.stdout);
  Alcotest.(check bool)
    "press start" true
    (contains_substring ~needle:"press Enter" result.stdout);
  Alcotest.(check bool)
    "harness projection" true
    (contains_substring ~needle:"derives .harness/ta.json" result.stdout);
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
          Alcotest.test_case "default config enter starts agent" `Quick
            expect_default_config_enter_starts_agent;
          Alcotest.test_case "harness config generates workspace dashboard"
            `Quick expect_harness_config_generates_workspace_dashboard;
          Alcotest.test_case "ta config wins over harness config" `Quick
            expect_ta_config_wins_over_harness_config;
          Alcotest.test_case
            "invalid harness config does not fall back to examples" `Quick
            expect_invalid_harness_config_does_not_fall_back_to_examples;
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
          Alcotest.test_case "miaou headless launcher axes and footer" `Quick
            expect_miaou_headless_launcher_axes_and_footer;
          Alcotest.test_case "miaou headless launcher footer pinned when tiny"
            `Quick expect_miaou_headless_launcher_footer_pinned_when_tiny;
          Alcotest.test_case "miaou headless tui respects short height" `Quick
            expect_miaou_headless_tui_respects_short_height;
          Alcotest.test_case "miaou headless tui uses collapsed width" `Quick
            expect_miaou_headless_tui_uses_full_collapsed_width;
          Alcotest.test_case "miaou headless enter without socket marks stale"
            `Quick expect_miaou_headless_tui_enter_without_socket_marks_stale;
          Alcotest.test_case "miaou headless enter aliases start" `Quick
            expect_miaou_headless_tui_enter_aliases_start;
          Alcotest.test_case "miaou headless enter refreshes attached agent"
            `Quick expect_miaou_headless_tui_enter_refreshes_attached_agent;
          Alcotest.test_case "miaou headless s rejects attached start" `Quick
            expect_miaou_headless_tui_s_rejects_attached_start;
          Alcotest.test_case "miaou headless direct start with config" `Quick
            expect_miaou_headless_tui_direct_start_with_config;
          Alcotest.test_case "miaou headless live preview visible when short"
            `Quick expect_miaou_headless_live_preview_is_visible_when_short;
        ] );
    ]
