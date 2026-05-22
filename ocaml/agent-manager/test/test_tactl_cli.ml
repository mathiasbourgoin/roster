type command_result = {
  status : Unix.process_status;
  stdout : string;
  stderr : string;
}

let tactl_exe () =
  match Sys.getenv_opt "TACTL_EXE" with
  | Some value -> value
  | None -> Alcotest.fail "TACTL_EXE is not set"

let fixture name = Filename.concat "fixtures" name
let remove_noerr path = try Sys.remove path with Sys_error _ -> ()

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

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

let run_tactl args =
  let argv = Array.of_list (tactl_exe () :: args) in
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
        Unix.create_process (tactl_exe ()) argv Unix.stdin
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

let expect_plain_validate_success () =
  let result = run_tactl [ "validate"; fixture "ta-valid.json" ] in
  check_exit "exit" 0 result.status;
  Alcotest.(check bool)
    "summary includes workspace" true
    (contains_substring ~needle:"- fixture: 2 agents" result.stdout)

let expect_roster_validate_success () =
  let result =
    run_tactl
      [
        "validate";
        "--roster-index";
        fixture "roster-index.json";
        fixture "ta-valid.json";
      ]
  in
  check_exit "exit" 0 result.status;
  Alcotest.(check string) "stderr" "" result.stderr;
  Alcotest.(check bool)
    "summary includes workspace" true
    (contains_substring ~needle:"- fixture: 2 agents" result.stdout)

let expect_roster_validate_failure () =
  let result =
    run_tactl
      [
        "validate";
        "--roster-index";
        fixture "roster-index.json";
        fixture "ta-missing-roster-agent.json";
      ]
  in
  check_exit "exit" 1 result.status;
  Alcotest.(check bool)
    "reports missing agent" true
    (contains_substring ~needle:"unknown roster agent: missing-agent"
       result.stderr)

let with_temp_state f =
  let path = Filename.temp_file "ta-cli-state" ".json" in
  Fun.protect ~finally:(fun () -> remove_noerr path) (fun () -> f path)

let expect_state_save_and_load () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      Alcotest.(check string) "save stderr" "" save.stderr;
      Alcotest.(check bool)
        "save output" true
        (contains_substring ~needle:"state snapshot written:" save.stdout);
      let load = run_tactl [ "state"; "load"; path ] in
      check_exit "load exit" 0 load.status;
      Alcotest.(check string) "load stderr" "" load.stderr;
      Alcotest.(check bool)
        "load summary" true
        (contains_substring
           ~needle:
             "TA state snapshot: 1 workspace(s), 2 agent(s), 1 audit event(s)"
           load.stdout))

let expect_state_load_failure () =
  let result = run_tactl [ "state"; "load"; fixture "missing-state.json" ] in
  check_exit "exit" 1 result.status;
  Alcotest.(check bool)
    "reports load error" true
    (contains_substring ~needle:"missing-state.json" result.stderr)

let () =
  Alcotest.run "tactl-cli"
    [
      ( "validate",
        [
          Alcotest.test_case "plain success" `Quick
            expect_plain_validate_success;
          Alcotest.test_case "roster success" `Quick
            expect_roster_validate_success;
          Alcotest.test_case "roster failure" `Quick
            expect_roster_validate_failure;
        ] );
      ( "state",
        [
          Alcotest.test_case "save and load" `Quick expect_state_save_and_load;
          Alcotest.test_case "load failure" `Quick expect_state_load_failure;
        ] );
    ]
