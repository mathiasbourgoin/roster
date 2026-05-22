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

let lines_containing ~needle value =
  value |> String.split_on_char '\n' |> List.filter (contains_substring ~needle)

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

let expect_launch_plan () =
  let result = run_tactl [ "launch"; "plan"; fixture "ta-valid.json" ] in
  check_exit "exit" 0 result.status;
  Alcotest.(check string) "stderr" "" result.stderr;
  Alcotest.(check bool)
    "plan header" true
    (contains_substring ~needle:"TA launch plan: 1 workspace(s), 2 agent(s)"
       result.stdout);
  Alcotest.(check bool)
    "lead target" true
    (contains_substring ~needle:"lead pane=fixture%lead target=ta-fixture:0.0"
       result.stdout)

let expect_launch_plan_roster_failure () =
  let result =
    run_tactl
      [
        "launch";
        "plan";
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

let expected_show
    ?(audit_lines = [ "#1 fixture actor=system workspace-loaded" ]) () =
  String.concat "\n"
    ([
       "TA state snapshot: 1 workspace(s), 2 agent(s), 3 audit event(s)";
       "- fixture: 2 agents, 1 links";
       "Workspace fixture (Fixture)";
       "  root: .";
       "  tmux_session: ta-fixture";
       "  active_view: agents";
       "  Agents:";
       "  - lead [running] roster=tech-lead pane=%77";
       "  - qa [not-started] roster=qa pane=-";
       "  Links:";
       "  - lead -> qa [read] fixture";
       "Recent audit:";
     ]
    @ List.map (fun line -> "  " ^ line) audit_lines)
  ^ "\n"

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

let expect_state_show_detail () =
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
      let show_default = run_tactl [ "state"; "show"; path ] in
      check_exit "show default exit" 0 show_default.status;
      Alcotest.(check string) "show default stderr" "" show_default.stderr;
      Alcotest.(check string)
        "show default stdout"
        (expected_show
           ~audit_lines:
             [
               "#1 fixture actor=system workspace-loaded";
               "#2 fixture actor=lead status lead: not-started -> running";
               "#3 fixture actor=lead pane lead: %77";
             ]
           ())
        show_default.stdout;
      let show = run_tactl [ "state"; "show"; "--audit-limit"; "2"; path ] in
      check_exit "show exit" 0 show.status;
      Alcotest.(check string) "show stderr" "" show.stderr;
      Alcotest.(check string)
        "show stdout"
        (expected_show
           ~audit_lines:
             [
               "#2 fixture actor=lead status lead: not-started -> running";
               "#3 fixture actor=lead pane lead: %77";
             ]
           ())
        show.stdout;
      let show_zero =
        run_tactl [ "state"; "show"; "--audit-limit"; "0"; path ]
      in
      check_exit "show zero exit" 0 show_zero.status;
      Alcotest.(check string)
        "show zero stdout"
        (expected_show ~audit_lines:[ "- none" ] ())
        show_zero.stdout)

let expect_state_show_rejects_negative_limit () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let show = run_tactl [ "state"; "show"; "--audit-limit=-1"; path ] in
      check_exit "exit" 2 show.status;
      Alcotest.(check bool)
        "reports audit limit" true
        (contains_substring ~needle:"--audit-limit must be non-negative"
           show.stderr))

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

let expect_runtime_snapshot_stdout () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result = run_tactl [ "runtime"; "snapshot"; path ] in
      check_exit "snapshot exit" 0 result.status;
      Alcotest.(check string) "snapshot stderr" "" result.stderr;
      let json = Yojson.Safe.from_string result.stdout in
      Alcotest.(check string)
        "version" "0.1.0"
        (json |> field "version" |> as_string "version");
      let workspace = workspace_json json in
      let lead = agent_json "lead" workspace in
      Alcotest.(check string)
        "lead unattached" "unattached"
        (lead |> field "pane_state" |> field "kind"
        |> as_string "pane_state.kind"))

let expect_runtime_snapshot_output_file () =
  with_temp_state (fun state_path ->
      let output_path = Filename.temp_file "ta-runtime" ".json" in
      Fun.protect
        ~finally:(fun () -> remove_noerr output_path)
        (fun () ->
          let save =
            run_tactl
              [
                "state"; "save"; "--output"; state_path; fixture "ta-valid.json";
              ]
          in
          check_exit "save exit" 0 save.status;
          let result =
            run_tactl
              [
                "runtime";
                "snapshot";
                "--lines";
                "5";
                "--output";
                output_path;
                state_path;
              ]
          in
          check_exit "snapshot exit" 0 result.status;
          Alcotest.(check bool)
            "summary" true
            (contains_substring ~needle:"TA runtime snapshot:" result.stdout);
          let json = Yojson.Safe.from_file output_path in
          Alcotest.(check string)
            "version" "0.1.0"
            (json |> field "version" |> as_string "version");
          let mode = (Unix.stat output_path).Unix.st_perm land 0o777 in
          Alcotest.(check int) "owner-only mode" 0o600 mode))

let expect_runtime_snapshot_rejects_bad_lines () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result = run_tactl [ "runtime"; "snapshot"; "--lines"; "0"; path ] in
      check_exit "snapshot exit" 2 result.status;
      Alcotest.(check bool)
        "line error" true
        (contains_substring ~needle:"--lines must be positive" result.stderr))

let expect_runtime_snapshot_rejects_large_lines () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result =
        run_tactl [ "runtime"; "snapshot"; "--lines"; "201"; path ]
      in
      check_exit "snapshot exit" 2 result.status;
      Alcotest.(check bool)
        "line cap" true
        (contains_substring ~needle:"--lines must be at most" result.stderr))

let expect_dashboard_render () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result = run_tactl [ "dashboard"; "render"; "--width"; "92"; path ] in
      check_exit "dashboard exit" 0 result.status;
      Alcotest.(check string) "dashboard stderr" "" result.stderr;
      Alcotest.(check bool)
        "dashboard header" true
        (contains_substring ~needle:"TA Dashboard" result.stdout);
      Alcotest.(check bool)
        "workspace row" true
        (contains_substring ~needle:"fixture" result.stdout);
      Alcotest.(check bool)
        "agent row" true
        (contains_substring ~needle:"lead" result.stdout);
      Alcotest.(check bool)
        "preview panel" true
        (contains_substring ~needle:"Preview: fixture/lead" result.stdout))

let expect_dashboard_render_replays_key () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result =
        run_tactl
          [ "dashboard"; "render"; "--width"; "92"; "--key"; "Down"; path ]
      in
      check_exit "dashboard exit" 0 result.status;
      Alcotest.(check string) "dashboard stderr" "" result.stderr;
      Alcotest.(check bool)
        "selected qa preview" true
        (contains_substring ~needle:"Preview: fixture/qa" result.stdout))

let expect_dashboard_render_replays_pipeline_key () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result =
        run_tactl
          [
            "dashboard";
            "render";
            "--width";
            "100";
            "--lines";
            "3";
            "--key";
            "p";
            "--key";
            "Down";
            path;
          ]
      in
      check_exit "dashboard exit" 0 result.status;
      Alcotest.(check string) "dashboard stderr" "" result.stderr;
      Alcotest.(check bool)
        "pipeline focus" true
        (contains_substring ~needle:"Pipeline overview [focus]" result.stdout);
      Alcotest.(check bool)
        "selected qa preview" true
        (contains_substring ~needle:"Preview: fixture/qa" result.stdout))

let expect_dashboard_render_replays_pipeline_edge_key () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result =
        run_tactl
          [
            "dashboard";
            "render";
            "--width";
            "100";
            "--key";
            "p";
            "--key";
            "Right";
            path;
          ]
      in
      check_exit "dashboard exit" 0 result.status;
      Alcotest.(check string) "dashboard stderr" "" result.stderr;
      Alcotest.(check bool)
        "pipeline edge focus" true
        (contains_substring ~needle:"> ACL fixture/lead -> read qa | write -"
           result.stdout);
      Alcotest.(check bool)
        "selected edge target preview" true
        (contains_substring ~needle:"Preview: fixture/qa" result.stdout);
      Alcotest.(check bool)
        "edge source metadata" true
        (contains_substring
           ~needle:
             "Edge source: fixture/lead pane - session ta-fixture runtime \
              DETACHED"
           result.stdout);
      Alcotest.(check bool)
        "edge target metadata" true
        (contains_substring
           ~needle:
             "Edge target: fixture/qa pane - session ta-fixture runtime \
              DETACHED"
           result.stdout);
      Alcotest.(check bool)
        "edge action" true
        (contains_substring ~needle:"Action: read target preview" result.stdout))

let expect_dashboard_render_uses_roster_index () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result =
        run_tactl
          [
            "dashboard";
            "render";
            "--width";
            "96";
            "--roster-index";
            fixture "roster-index.json";
            path;
          ]
      in
      check_exit "dashboard exit" 0 result.status;
      Alcotest.(check string) "dashboard stderr" "" result.stderr;
      Alcotest.(check bool)
        "row metadata" true
        (contains_substring ~needle:"Tech Lead/management" result.stdout);
      Alcotest.(check bool)
        "preview metadata" true
        (contains_substring
           ~needle:
             "Roster: Tech Lead | domain management,orchestration | source \
              local"
           result.stdout);
      Alcotest.(check bool)
        "frontmatter profile metadata" true
        (contains_substring
           ~needle:"Profile: model opus | complexity high | isolation none"
           result.stdout);
      Alcotest.(check bool)
        "frontmatter compatibility metadata" true
        (contains_substring
           ~needle:"Compat: claude-code,codex | version 9.9.9 | author mathias"
           result.stdout);
      Alcotest.(check bool)
        "frontmatter role metadata" true
        (contains_substring
           ~needle:"Role: Frontmatter coordinates implementation and review."
           result.stdout);
      Alcotest.(check bool)
        "pipeline trigger metadata" true
        (contains_substring ~needle:"Pipeline: triggered by fixture"
           result.stdout);
      Alcotest.(check bool)
        "pipeline receives metadata" true
        (contains_substring ~needle:"Receives: fixture task" result.stdout);
      Alcotest.(check bool)
        "pipeline produces metadata" true
        (contains_substring ~needle:"Produces: fixture plan" result.stdout);
      Alcotest.(check bool)
        "pipeline gate metadata" true
        (contains_substring ~needle:"Human gate: none" result.stdout);
      Alcotest.(check (list string))
        "pipeline appears only in preview detail"
        [ "Pipeline: triggered by fixture" ]
        (result.stdout
        |> lines_containing ~needle:"Pipeline:"
        |> List.map String.trim);
      Alcotest.(check bool)
        "pipeline overview section" true
        (contains_substring ~needle:"Pipeline overview" result.stdout);
      Alcotest.(check bool)
        "pipeline overview contract flag" true
        (contains_substring ~needle:"Tech Lead              contract"
           result.stdout);
      Alcotest.(check bool)
        "pipeline overview acl disclaimer" true
        (contains_substring
           ~needle:"ACL edges (declared links, not inferred workflow order)"
           result.stdout);
      Alcotest.(check bool)
        "pipeline overview acl edge" true
        (contains_substring ~needle:"ACL fixture/lead -> read qa | write -"
           result.stdout))

let expect_dashboard_render_rejects_bad_width () =
  with_temp_state (fun path ->
      let save =
        run_tactl [ "state"; "save"; "--output"; path; fixture "ta-valid.json" ]
      in
      check_exit "save exit" 0 save.status;
      let result = run_tactl [ "dashboard"; "render"; "--width"; "0"; path ] in
      check_exit "dashboard exit" 2 result.status;
      Alcotest.(check bool)
        "width error" true
        (contains_substring ~needle:"--width must be positive" result.stderr))

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
          Alcotest.test_case "show detail" `Quick expect_state_show_detail;
          Alcotest.test_case "show rejects negative limit" `Quick
            expect_state_show_rejects_negative_limit;
          Alcotest.test_case "unknown actor keeps snapshot" `Quick
            expect_state_unknown_actor_keeps_snapshot;
          Alcotest.test_case "bad status" `Quick expect_state_bad_status;
          Alcotest.test_case "load failure" `Quick expect_state_load_failure;
        ] );
      ( "launch",
        [
          Alcotest.test_case "plan" `Quick expect_launch_plan;
          Alcotest.test_case "roster failure" `Quick
            expect_launch_plan_roster_failure;
        ] );
      ( "runtime",
        [
          Alcotest.test_case "snapshot stdout" `Quick
            expect_runtime_snapshot_stdout;
          Alcotest.test_case "snapshot output file" `Quick
            expect_runtime_snapshot_output_file;
          Alcotest.test_case "snapshot rejects bad lines" `Quick
            expect_runtime_snapshot_rejects_bad_lines;
          Alcotest.test_case "snapshot rejects large lines" `Quick
            expect_runtime_snapshot_rejects_large_lines;
        ] );
      ( "dashboard",
        [
          Alcotest.test_case "render" `Quick expect_dashboard_render;
          Alcotest.test_case "render replays key" `Quick
            expect_dashboard_render_replays_key;
          Alcotest.test_case "render replays pipeline key" `Quick
            expect_dashboard_render_replays_pipeline_key;
          Alcotest.test_case "render replays pipeline edge key" `Quick
            expect_dashboard_render_replays_pipeline_edge_key;
          Alcotest.test_case "render uses roster index" `Quick
            expect_dashboard_render_uses_roster_index;
          Alcotest.test_case "render rejects bad width" `Quick
            expect_dashboard_render_rejects_bad_width;
        ] );
    ]
