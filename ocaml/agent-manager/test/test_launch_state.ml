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
        {"name": "qa", "roster_agent": "qa", "command": ["codex"]}
      ]
    }
  ]
}
|}

let parsed_config () =
  match Ta_core.Workspace_config.parse_string config with
  | Ok config -> config
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let plan () =
  match Ta_core.Launch_plan.of_config (parsed_config ()) with
  | Ok plan -> plan
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let store () =
  match Ta_core.State_store.of_config (parsed_config ()) with
  | Ok store -> store
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let planned_agents plan =
  List.concat_map
    (fun workspace -> workspace.Ta_core.Launch_plan.agents)
    plan.Ta_core.Launch_plan.workspaces

let pane_for_agent agent =
  Ta_core.Id.Pane.unsafe_of_string
    ("%42-" ^ Ta_core.Id.Agent.to_string agent.Ta_core.Launch_plan.name)

let attachment_of_agent (agent : Ta_core.Launch_plan.agent) =
  {
    Ta_core.Launch_runtime.workspace = agent.Ta_core.Launch_plan.workspace;
    agent = agent.name;
    planned_pane = agent.planned_pane;
    pane = pane_for_agent agent;
    identity =
      Ta_core.Tmux.unsafe_pane_identity ~session_id:"$1" ~window_id:"@1";
    target = Ta_core.Tmux.unsafe_target_of_string agent.tmux_target;
  }

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let find_agent store workspace agent =
  match Ta_core.State_store.find_workspace store workspace with
  | Error message -> Alcotest.fail message
  | Ok workspace -> (
      match Ta_core.State_store.find_agent workspace agent with
      | Error message -> Alcotest.fail message
      | Ok agent -> agent)

let expect_preflight_and_apply () =
  let plan = plan () in
  let store = store () in
  (match Ta_core.Launch_state.preflight store plan with
  | Ok () -> ()
  | Error message -> Alcotest.fail message);
  let attachments = List.map attachment_of_agent (planned_agents plan) in
  match Ta_core.Launch_state.apply_attachments store attachments with
  | Error message -> Alcotest.fail message
  | Ok updated ->
      Alcotest.(check int)
        "load + two pane events" 3
        (List.length (Ta_core.State_store.audit_events updated));
      List.iter
        (fun (attachment : Ta_core.Launch_runtime.attachment) ->
          let agent =
            find_agent updated attachment.workspace attachment.agent
          in
          Alcotest.(check bool)
            "pane attached" true
            (Option.equal Ta_core.Id.Pane.equal agent.pane
               (Some attachment.pane)))
        attachments

let expect_preflight_agent_rejects_attached_agent () =
  let plan = plan () in
  let store = store () in
  let agent =
    match planned_agents plan with
    | agent :: _ -> agent
    | [] -> Alcotest.fail "expected planned agent"
  in
  let attachment = attachment_of_agent agent in
  match Ta_core.Launch_state.apply_attachments store [ attachment ] with
  | Error message -> Alcotest.fail message
  | Ok updated -> (
      match Ta_core.Launch_state.preflight_agent updated agent with
      | Ok () -> Alcotest.fail "attached agent should fail preflight"
      | Error message ->
          Alcotest.(check bool)
            "attached error" true
            (contains_substring ~needle:"already has pane" message))

let () =
  Alcotest.run "launch-state"
    [
      ( "launch_state",
        [
          Alcotest.test_case "preflight and apply attachments" `Quick
            expect_preflight_and_apply;
          Alcotest.test_case "preflight rejects attached agent" `Quick
            expect_preflight_agent_rejects_attached_agent;
        ] );
    ]
