type command_result = {
  status : Unix.process_status;
  stdout : string;
  stderr : string;
}

let ta_exe () =
  match Sys.getenv_opt "TA_EXE" with
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

let with_temp_state f =
  let path = Filename.temp_file "ta-cli-state" ".json" in
  Fun.protect ~finally:(fun () -> remove_noerr path) (fun () -> f path)

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

let () =
  Alcotest.run "ta-cli"
    [
      ( "dashboard",
        [
          Alcotest.test_case "state dashboard" `Quick expect_state_dashboard;
          Alcotest.test_case "state dashboard replays key" `Quick
            expect_state_dashboard_replays_key;
          Alcotest.test_case "rejects bad width" `Quick expect_rejects_bad_width;
        ] );
    ]
