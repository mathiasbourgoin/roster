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

let field name = function
  | `Assoc fields -> (
      match List.assoc_opt name fields with
      | Some value -> value
      | None -> Alcotest.fail ("missing JSON field: " ^ name))
  | _ -> Alcotest.fail ("expected JSON object for field: " ^ name)

let as_list label = function
  | `List values -> values
  | _ -> Alcotest.fail ("expected JSON list: " ^ label)

let as_string label = function
  | `String value -> value
  | _ -> Alcotest.fail ("expected JSON string: " ^ label)

let workspace_json snapshot =
  match snapshot |> field "workspaces" |> as_list "workspaces" with
  | workspace :: _ -> workspace
  | [] -> Alcotest.fail "expected workspace"

let agent_json name workspace =
  workspace |> field "agents" |> as_list "agents"
  |> List.find_opt (fun agent ->
      String.equal name (agent |> field "name" |> as_string "agent.name"))
  |> function
  | Some agent -> agent
  | None -> Alcotest.fail ("missing agent: " ^ name)

let last_audit_kind snapshot =
  let events = snapshot |> field "audit_events" |> as_list "audit_events" in
  match List.rev events with
  | event :: _ -> event |> field "kind" |> field "kind" |> as_string "kind.kind"
  | [] -> Alcotest.fail "expected audit event"

let expect_state_mutations () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let status =
        run_tactl
          [
            "state";
            "set-status";
            path;
            "--workspace";
            "fixture";
            "--agent";
            "lead";
            "--status";
            "running";
            "--actor";
            "lead";
          ]
      in
      check_exit "status exit" 0 status.status;
      Alcotest.(check string) "status stderr" "" status.stderr;
      Alcotest.(check bool)
        "status event count" true
        (contains_substring ~needle:"2 audit event(s)" status.stdout);
      let pane =
        run_tactl
          [
            "state";
            "attach-pane";
            path;
            "--workspace";
            "fixture";
            "--agent";
            "lead";
            "--pane";
            "%77";
            "--actor";
            "lead";
          ]
      in
      check_exit "pane exit" 0 pane.status;
      Alcotest.(check string) "pane stderr" "" pane.stderr;
      Alcotest.(check bool)
        "pane event count" true
        (contains_substring ~needle:"3 audit event(s)" pane.stdout);
      let load = run_tactl [ "state"; "load"; path ] in
      check_exit "load exit" 0 load.status;
      Alcotest.(check bool)
        "load event count" true
        (contains_substring ~needle:"3 audit event(s)" load.stdout);
      let snapshot = Yojson.Safe.from_file path in
      let agent = snapshot |> workspace_json |> agent_json "lead" in
      Alcotest.(check string)
        "persisted status" "running"
        (agent |> field "status" |> field "kind" |> as_string "status.kind");
      Alcotest.(check string)
        "persisted pane" "%77"
        (agent |> field "pane" |> as_string "pane");
      Alcotest.(check string)
        "last audit kind" "pane-attached" (last_audit_kind snapshot))

let expect_state_unknown_actor_keeps_snapshot () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let before = Yojson.Safe.from_file path |> Yojson.Safe.to_string in
      let result =
        run_tactl
          [
            "state";
            "set-status";
            path;
            "--workspace";
            "fixture";
            "--agent";
            "lead";
            "--status";
            "done";
            "--actor";
            "missing";
          ]
      in
      check_exit "exit" 1 result.status;
      Alcotest.(check bool)
        "reports actor" true
        (contains_substring ~needle:"unknown agent: missing" result.stderr);
      let after = Yojson.Safe.from_file path |> Yojson.Safe.to_string in
      Alcotest.(check string) "snapshot unchanged" before after)

let expect_state_bad_status () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result =
        run_tactl
          [
            "state";
            "set-status";
            path;
            "--workspace";
            "fixture";
            "--agent";
            "lead";
            "--status";
            "blocked";
          ]
      in
      check_exit "exit" 2 result.status;
      Alcotest.(check bool)
        "reports reason" true
        (contains_substring ~needle:"requires a non-empty reason" result.stderr))

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
          Alcotest.test_case "mutations" `Quick expect_state_mutations;
          Alcotest.test_case "unknown actor keeps snapshot" `Quick
            expect_state_unknown_actor_keeps_snapshot;
          Alcotest.test_case "bad status" `Quick expect_state_bad_status;
          Alcotest.test_case "load failure" `Quick expect_state_load_failure;
        ] );
    ]
