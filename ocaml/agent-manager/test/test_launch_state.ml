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

let selected_agent plan =
  match plan.Ta_core.Launch_plan.workspaces with
  | workspace :: _ -> (
      match workspace.Ta_core.Launch_plan.agents with
      | agent :: _ -> { Ta_core.Launch_plan.workspace; agent }
      | [] -> Alcotest.fail "expected planned agent")
  | [] -> Alcotest.fail "expected planned workspace"

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
  let selected = selected_agent plan in
  let agent = selected.Ta_core.Launch_plan.agent in
  let attachment = attachment_of_agent agent in
  match Ta_core.Launch_state.apply_attachments store [ attachment ] with
  | Error message -> Alcotest.fail message
  | Ok updated -> (
      match Ta_core.Launch_state.preflight_agent updated selected with
      | Ok () -> Alcotest.fail "attached agent should fail preflight"
      | Error message ->
          Alcotest.(check bool)
            "attached error" true
            (contains_substring ~needle:"already has pane" message))

let expect_preflight_agent_rejects_launch_drift () =
  let store = store () in
  let base_selected = selected_agent (plan ()) in
  let base_agent = base_selected.Ta_core.Launch_plan.agent in
  let cases =
    [
      ("command", { base_agent with command = [ "claude" ] }, "claude");
      ( "cwd",
        {
          base_agent with
          configured_cwd = Some "subdir";
          cwd = "subdir";
        },
        "subdir" );
      ( "env",
        { base_agent with env = [ ("MODEL", "opus") ] },
        "MODEL=opus" );
      ("prompt", { base_agent with startup_prompt = Some "hello" }, "hello");
    ]
  in
  List.iter
    (fun (label, agent, leaked_value) ->
      let selected = { base_selected with agent } in
      match Ta_core.Launch_state.preflight_agent store selected with
      | Ok () -> Alcotest.fail (label ^ " drift should fail preflight")
      | Error message ->
          Alcotest.(check bool)
            (label ^ " drift error")
            true
            (contains_substring ~needle:"launch profile changed" message);
          Alcotest.(check bool)
            (label ^ " drift redacts value")
            false
            (contains_substring ~needle:leaked_value message))
    cases

let expect_preflight_rejects_workspace_launch_drift () =
  let store = store () in
  let base_plan = plan () in
  let base_selected = selected_agent base_plan in
  let base_workspace = base_selected.Ta_core.Launch_plan.workspace in
  let cases =
    [
      ("root", { base_workspace with root = "changed-root" }, "changed-root");
      ( "session",
        {
          base_workspace with
          session = Ta_core.Tmux.unsafe_session_of_string "ta-changed";
        },
        "ta-changed" );
    ]
  in
  List.iter
    (fun (label, workspace, leaked_value) ->
      let selected = { base_selected with workspace } in
      match Ta_core.Launch_state.preflight_agent store selected with
      | Ok () -> Alcotest.fail (label ^ " drift should fail agent preflight")
      | Error message ->
          Alcotest.(check bool)
            (label ^ " agent drift error")
            true
            (contains_substring
               ~needle:"workspace fixture launch identity changed" message);
          Alcotest.(check bool)
            (label ^ " agent drift redacts value")
            false
            (contains_substring ~needle:leaked_value message);
          let drifted_plan =
            { Ta_core.Launch_plan.workspaces = [ workspace ] }
          in
          match Ta_core.Launch_state.preflight store drifted_plan with
          | Ok () ->
              Alcotest.fail (label ^ " drift should fail plan preflight")
          | Error message ->
              Alcotest.(check bool)
                (label ^ " plan drift error")
                true
                (contains_substring
                   ~needle:"workspace fixture launch identity changed" message))
    cases

let expect_preflight_accepts_normalized_workspace_roots () =
  let config = parsed_config () in
  let store =
    match
      Ta_core.State_store.of_config ~config_dir:"/tmp/ta-workspace/." config
    with
    | Ok store -> store
    | Error errors ->
        Alcotest.fail
          (String.concat "\n"
             (List.map Ta_core.Workspace_config.error_to_string errors))
  in
  let plan =
    match Ta_core.Launch_plan.of_config ~config_dir:"/tmp/ta-workspace" config with
    | Ok plan -> plan
    | Error errors ->
        Alcotest.fail
          (String.concat "\n"
             (List.map Ta_core.Workspace_config.error_to_string errors))
  in
  match Ta_core.Launch_state.preflight store plan with
  | Ok () -> ()
  | Error message -> Alcotest.fail message

let () =
  Alcotest.run "launch-state"
    [
      ( "launch_state",
        [
          Alcotest.test_case "preflight and apply attachments" `Quick
            expect_preflight_and_apply;
          Alcotest.test_case "preflight rejects attached agent" `Quick
            expect_preflight_agent_rejects_attached_agent;
          Alcotest.test_case "preflight rejects launch drift" `Quick
            expect_preflight_agent_rejects_launch_drift;
          Alcotest.test_case "preflight rejects workspace launch drift" `Quick
            expect_preflight_rejects_workspace_launch_drift;
          Alcotest.test_case "preflight accepts normalized workspace roots"
            `Quick expect_preflight_accepts_normalized_workspace_roots;
        ] );
    ]
