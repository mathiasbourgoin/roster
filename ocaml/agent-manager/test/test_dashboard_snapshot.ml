let config =
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
        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]},
        {"name": "qa", "roster_agent": "qa", "command": ["codex"]},
        {"name": "writer", "roster_agent": "documenter", "command": ["codex"]}
      ],
      "links": [
        {"from": "lead", "to": "qa", "permissions": ["read"], "reason": "delegate QA"},
        {"from": "lead", "to": "writer", "permissions": ["write"], "reason": "draft handoff"}
      ]
    }
  ]
}
|}

let workspace = Ta_core.Id.Workspace.unsafe_of_string "fixture"
let lead = Ta_core.Id.Agent.unsafe_of_string "lead"
let qa = Ta_core.Id.Agent.unsafe_of_string "qa"
let lead_pane = Ta_core.Id.Pane.unsafe_of_string "%11"
let qa_pane = Ta_core.Id.Pane.unsafe_of_string "%12"

let lead_identity =
  Ta_core.Tmux.unsafe_pane_identity ~session_id:"$1" ~window_id:"@1"

let qa_identity =
  Ta_core.Tmux.unsafe_pane_identity ~session_id:"$1" ~window_id:"@2"

let parse_config () =
  match Ta_core.Workspace_config.parse_string config with
  | Ok config -> config
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let attach store agent pane identity =
  match
    Ta_core.State_store.attach_pane ~identity store ~workspace ~agent ~pane
      ~actor:None
  with
  | Ok store -> store
  | Error message -> Alcotest.fail message

let store () =
  match Ta_core.State_store.of_config (parse_config ()) with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok store ->
      store |> fun store ->
      attach store lead lead_pane lead_identity |> fun store ->
      attach store qa qa_pane qa_identity

let tmux_error output =
  {
    Ta_core.Tmux.argv = [ "tmux"; "capture-pane" ];
    status = Unix.WEXITED 1;
    output;
  }

let runner = function
  | Ta_core.Tmux.Display_pane_identity target
    when String.equal (Ta_core.Tmux.target_to_string target) "%11" ->
      Ok "$1\t@1\n"
  | Ta_core.Tmux.Display_pane_identity _ -> Ok "$1\t@2\n"
  | Ta_core.Tmux.Capture_pane { target; _ }
    when String.equal (Ta_core.Tmux.target_to_string target) "%11" ->
      Ok "lead-ready\n"
  | Ta_core.Tmux.Capture_pane _ -> Ok "qa-ready\n"
  | command ->
      Error (tmux_error ("unexpected: " ^ Ta_core.Tmux.command_line command))

let runtime_agent_names snapshot =
  snapshot.Ta_core.Dashboard_snapshot.runtime.workspaces
  |> List.concat_map (fun workspace ->
      workspace.Ta_core.Runtime_snapshot.agents)
  |> List.map (fun (agent : Ta_core.Runtime_snapshot.agent) ->
      Ta_core.Id.Agent.to_string agent.name)

let state_agent_names snapshot =
  Ta_core.State_store.workspaces snapshot.Ta_core.Dashboard_snapshot.state
  |> List.concat_map (fun (workspace : Ta_core.State_store.workspace) ->
      workspace.agents)
  |> List.map (fun (agent : Ta_core.State_store.agent) ->
      Ta_core.Id.Agent.to_string agent.name)

let audit_count snapshot =
  snapshot.Ta_core.Dashboard_snapshot.state |> Ta_core.State_store.audit_events
  |> List.length

let expect_actor_scoped_snapshot () =
  let state = store () in
  let lead_snapshot =
    match
      Ta_core.Dashboard_snapshot.of_state_for_actor ~now:42.0 ~lines:5 ~runner
        state ~actor:lead
    with
    | Ok snapshot -> snapshot
    | Error message -> Alcotest.fail message
  in
  Alcotest.(check (list string))
    "lead sees self and qa" [ "lead"; "qa" ]
    (runtime_agent_names lead_snapshot);
  Alcotest.(check (list string))
    "lead state sees writable writer" [ "lead"; "qa"; "writer" ]
    (state_agent_names lead_snapshot);
  let qa_snapshot =
    match
      Ta_core.Dashboard_snapshot.of_state_for_actor ~now:42.0 ~lines:5 ~runner
        state ~actor:qa
    with
    | Ok snapshot -> snapshot
    | Error message -> Alcotest.fail message
  in
  Alcotest.(check (list string))
    "qa sees self" [ "qa" ]
    (runtime_agent_names qa_snapshot);
  Alcotest.(check (list string))
    "qa state sees self" [ "qa" ]
    (state_agent_names qa_snapshot);
  Alcotest.(check int) "lead audit hidden" 0 (audit_count lead_snapshot);
  Alcotest.(check int) "qa audit hidden" 0 (audit_count qa_snapshot)

let expect_roundtrip_json () =
  let state = store () in
  let snapshot =
    match
      Ta_core.Dashboard_snapshot.of_state_for_actor ~now:42.0 ~lines:5 ~runner
        state ~actor:lead
    with
    | Ok snapshot -> snapshot
    | Error message -> Alcotest.fail message
  in
  match
    snapshot |> Ta_core.Dashboard_snapshot.to_yojson
    |> Ta_core.Dashboard_snapshot.of_yojson
  with
  | Error message -> Alcotest.fail message
  | Ok parsed ->
      Alcotest.(check (list string))
        "agents" [ "lead"; "qa" ]
        (runtime_agent_names parsed)

let expect_bounded_json_caps_preview () =
  let big_runner = function
    | Ta_core.Tmux.Display_pane_identity target
      when String.equal (Ta_core.Tmux.target_to_string target) "%11" ->
        Ok "$1\t@1\n"
    | Ta_core.Tmux.Display_pane_identity _ -> Ok "$1\t@2\n"
    | Ta_core.Tmux.Capture_pane _ -> Ok (String.make 100_000 'x')
    | command ->
        Error (tmux_error ("unexpected: " ^ Ta_core.Tmux.command_line command))
  in
  let snapshot =
    match
      Ta_core.Dashboard_snapshot.of_state_for_actor ~now:42.0 ~lines:5
        ~runner:big_runner (store ()) ~actor:lead
    with
    | Ok snapshot -> snapshot
    | Error message -> Alcotest.fail message
  in
  let unbounded =
    snapshot |> Ta_core.Dashboard_snapshot.to_yojson |> Yojson.Safe.to_string
  in
  Alcotest.(check bool)
    "unbounded exceeds test cap" true
    (String.length unbounded > 3_000);
  match
    Ta_core.Dashboard_snapshot.to_bounded_yojson_string ~max_bytes:3_000
      ~encoded_length:String.length snapshot
  with
  | Error message -> Alcotest.fail message
  | Ok bounded ->
      Alcotest.(check bool)
        "bounded under cap" true
        (String.length bounded <= 3_000)

let expect_rejects_unknown_actor () =
  let actor = Ta_core.Id.Agent.unsafe_of_string "missing" in
  match Ta_core.Dashboard_snapshot.of_state_for_actor (store ()) ~actor with
  | Ok _ -> Alcotest.fail "expected unknown actor"
  | Error message ->
      Alcotest.(check string) "error" "unknown actor: missing" message

let () =
  Alcotest.run "dashboard-snapshot"
    [
      ( "dashboard_snapshot",
        [
          Alcotest.test_case "actor scoped snapshot" `Quick
            expect_actor_scoped_snapshot;
          Alcotest.test_case "roundtrip json" `Quick expect_roundtrip_json;
          Alcotest.test_case "bounded json caps preview" `Quick
            expect_bounded_json_caps_preview;
          Alcotest.test_case "rejects unknown actor" `Quick
            expect_rejects_unknown_actor;
        ] );
    ]
