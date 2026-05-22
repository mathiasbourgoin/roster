let config =
  {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "fixture",
      "label": "Fixture Workspace",
      "root": ".",
      "tmux_session": "ta-fixture",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]},
        {"name": "qa", "roster_agent": "qa", "command": ["codex"]},
        {"name": "docs", "roster_agent": "documenter", "command": ["codex"]}
      ],
      "links": [
        {"from": "lead", "to": "qa", "permissions": ["read", "write"], "reason": "delegate QA"}
      ]
    }
  ]
}
|}

let workspace = Ta_core.Id.Workspace.unsafe_of_string "fixture"
let lead = Ta_core.Id.Agent.unsafe_of_string "lead"
let qa = Ta_core.Id.Agent.unsafe_of_string "qa"
let lead_pane = Ta_core.Id.Pane.unsafe_of_string "%11"

let lead_identity =
  Ta_core.Tmux.unsafe_pane_identity ~session_id:"$1" ~window_id:"@1"

let parse_config () =
  match Ta_core.Workspace_config.parse_string config with
  | Ok config -> config
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let store () =
  match Ta_core.State_store.of_config (parse_config ()) with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok store -> (
      match
        Ta_core.State_store.set_agent_status store ~workspace ~agent:lead
          ~status:Ta_core.State_store.Running ~actor:None
      with
      | Error message -> Alcotest.fail message
      | Ok store -> (
          match
            Ta_core.State_store.set_agent_status store ~workspace ~agent:qa
              ~status:(Ta_core.State_store.Blocked "waiting on review")
              ~actor:None
          with
          | Error message -> Alcotest.fail message
          | Ok store -> (
              match
                Ta_core.State_store.attach_pane ~identity:lead_identity store
                  ~workspace ~agent:lead ~pane:lead_pane ~actor:None
              with
              | Error message -> Alcotest.fail message
              | Ok store -> store)))

let tmux_error output =
  {
    Ta_core.Tmux.argv = [ "tmux"; "capture-pane" ];
    status = Unix.WEXITED 1;
    output;
  }

let runner = function
  | Ta_core.Tmux.Display_pane_identity _ -> Ok "$1\t@1\n"
  | Ta_core.Tmux.Capture_pane { lines; _ } ->
      Alcotest.(check int) "lines" 8 lines;
      Ok "lead-ready\nreviewing patch\n"
  | command ->
      Error (tmux_error ("unexpected: " ^ Ta_core.Tmux.command_line command))

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let expect_dashboard_model_counts () =
  let store = store () in
  let runtime =
    Ta_core.Runtime_snapshot.collect ~now:42.0 ~lines:8 ~runner store
  in
  let model = Ta_core.Dashboard_model.of_state_runtime store runtime in
  Alcotest.(check int) "workspaces" 1 model.totals.workspace_count;
  Alcotest.(check int) "agents" 3 model.totals.agent_count;
  Alcotest.(check int) "live" 1 model.totals.live_count;
  Alcotest.(check int) "blocked" 1 model.totals.blocked_count;
  match model.workspaces with
  | [ workspace ] ->
      Alcotest.(check int) "workspace live" 1 workspace.live_count;
      Alcotest.(check int) "workspace links" 1 workspace.link_count
  | _ -> Alcotest.fail "expected one workspace"

let expect_dashboard_render_frame () =
  let store = store () in
  let runtime =
    Ta_core.Runtime_snapshot.collect ~now:42.0 ~lines:8 ~runner store
  in
  let model = Ta_core.Dashboard_model.of_state_runtime store runtime in
  let rendered = Ta_core.Dashboard_model.render ~width:96 model in
  Alcotest.(check bool)
    "title" true
    (contains_substring ~needle:"TA Dashboard" rendered);
  Alcotest.(check bool)
    "workspace" true
    (contains_substring ~needle:"Fixture Workspace" rendered);
  Alcotest.(check bool) "lead" true (contains_substring ~needle:"lead" rendered);
  Alcotest.(check bool)
    "connections" true
    (contains_substring ~needle:"R:qa W:qa" rendered);
  Alcotest.(check bool)
    "preview header" true
    (contains_substring ~needle:"Preview: fixture/lead" rendered);
  Alcotest.(check bool)
    "preview body" true
    (contains_substring ~needle:"lead-ready" rendered)

let expect_dashboard_roster_enrichment () =
  let store = store () in
  let runtime =
    Ta_core.Runtime_snapshot.collect ~now:42.0 ~lines:8 ~runner store
  in
  let roster =
    match
      Ta_core.Roster_index.parse_string
        {|
[
  {
    "name": "tech-lead",
    "display_name": "Tech Lead",
    "description": "Coordinates implementation.",
    "domain": ["management"],
    "tags": ["planning"],
    "source": "local",
    "component_type": "agent"
  },
  {
    "name": "qa",
    "display_name": "QA",
    "domain": ["testing"],
    "tags": ["tmux"],
    "source": "local",
    "component_type": "agent"
  }
]
|}
    with
    | Ok roster -> roster
    | Error errors ->
        Alcotest.fail
          (String.concat "\n"
             (List.map Ta_core.Roster_index.error_to_string errors))
  in
  let model =
    Ta_core.Dashboard_model.of_state_runtime store runtime
    |> Ta_core.Dashboard_model.enrich_with_roster roster
  in
  let rendered = Ta_core.Dashboard_model.render ~width:120 model in
  Alcotest.(check bool)
    "roster header" true
    (contains_substring ~needle:"ROSTER" rendered);
  Alcotest.(check bool)
    "lead metadata" true
    (contains_substring ~needle:"Tech Lead/management" rendered);
  Alcotest.(check bool)
    "lead preview metadata" true
    (contains_substring
       ~needle:
         "Roster: Tech Lead | domain management | source local | tags planning"
       rendered);
  Alcotest.(check bool)
    "qa metadata" true
    (contains_substring ~needle:"QA/testing" rendered)

let expect_dashboard_render_respects_width () =
  let long_workspace =
    Ta_core.Id.Workspace.unsafe_of_string
      "workspace-with-a-very-long-dashboard-name"
  in
  let long_agent =
    Ta_core.Id.Agent.unsafe_of_string "agent-with-a-very-long-dashboard-name"
  in
  let store =
    match Ta_core.State_store.of_config (parse_config ()) with
    | Error errors ->
        Alcotest.fail
          (String.concat "\n"
             (List.map Ta_core.Workspace_config.error_to_string errors))
    | Ok _ -> (
        let config =
          Printf.sprintf
            {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "%s",
      "label": "Long Dashboard Workspace",
      "root": ".",
      "tmux_session": "ta-long-dashboard",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {"name": "%s", "roster_agent": "tech-lead", "command": ["codex"]}
      ]
    }
  ]
}
|}
            (Ta_core.Id.Workspace.to_string long_workspace)
            (Ta_core.Id.Agent.to_string long_agent)
        in
        let config =
          match Ta_core.Workspace_config.parse_string config with
          | Ok config -> config
          | Error errors ->
              Alcotest.fail
                (String.concat "\n"
                   (List.map Ta_core.Workspace_config.error_to_string errors))
        in
        match Ta_core.State_store.of_config config with
        | Ok store -> store
        | Error errors ->
            Alcotest.fail
              (String.concat "\n"
                 (List.map Ta_core.Workspace_config.error_to_string errors)))
  in
  let runtime = Ta_core.Runtime_snapshot.collect ~now:42.0 store in
  let rendered =
    Ta_core.Dashboard_model.of_state_runtime store runtime
    |> Ta_core.Dashboard_model.render ~width:72
  in
  rendered |> String.split_on_char '\n'
  |> List.iter (fun line ->
      Alcotest.(check bool)
        ("line width: " ^ line) true
        (String.length line <= 72))

let () =
  Alcotest.run "dashboard-model"
    [
      ( "dashboard_model",
        [
          Alcotest.test_case "counts" `Quick expect_dashboard_model_counts;
          Alcotest.test_case "render frame" `Quick expect_dashboard_render_frame;
          Alcotest.test_case "roster enrichment" `Quick
            expect_dashboard_roster_enrichment;
          Alcotest.test_case "render respects width" `Quick
            expect_dashboard_render_respects_width;
        ] );
    ]
