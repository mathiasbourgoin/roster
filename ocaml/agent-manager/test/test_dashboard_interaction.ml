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
        {"name": "qa", "roster_agent": "qa", "command": ["codex"]}
      ],
      "links": [
        {"from": "lead", "to": "qa", "permissions": ["read", "write"], "reason": "qa handoff"}
      ]
    },
    {
      "id": "docs",
      "label": "Docs Workspace",
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
|}

let config_without_links =
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
        {"name": "qa", "roster_agent": "qa", "command": ["codex"]}
      ]
    },
    {
      "id": "docs",
      "label": "Docs Workspace",
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
|}

let parse_config () =
  match Ta_core.Workspace_config.parse_string config with
  | Ok config -> config
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let parse_config_text text =
  match Ta_core.Workspace_config.parse_string text with
  | Ok config -> config
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let store_of_config config =
  match Ta_core.State_store.of_config config with
  | Ok store -> store
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let store () = store_of_config (parse_config ())

let dashboard () =
  let store = store () in
  let runtime = Ta_core.Runtime_snapshot.collect ~now:42.0 store in
  Ta_core.Dashboard_model.of_state_runtime store runtime

let dashboard_without_links () =
  let store = store_of_config (parse_config_text config_without_links) in
  let runtime = Ta_core.Runtime_snapshot.collect ~now:42.0 store in
  Ta_core.Dashboard_model.of_state_runtime store runtime

let as_string option =
  Option.map Ta_core.Id.Agent.to_string option |> Option.value ~default:"-"

let as_workspace option =
  Option.map Ta_core.Id.Workspace.to_string option |> Option.value ~default:"-"

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let expect_initial_selection () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  Alcotest.(check string)
    "workspace" "fixture"
    (as_workspace (Ta_core.Dashboard_interaction.selected_workspace state));
  Alcotest.(check string)
    "agent" "lead"
    (as_string (Ta_core.Dashboard_interaction.selected_agent state));
  Alcotest.(check bool)
    "refresh" false
    (Ta_core.Dashboard_interaction.refresh_requested state);
  Alcotest.(check bool)
    "fresh" true
    (match Ta_core.Dashboard_interaction.refresh_status state with
    | Ta_core.Dashboard_interaction.Fresh -> true
    | Refreshing | Stale _ -> false)

let expect_agent_navigation () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "Down" in
  Alcotest.(check string)
    "next agent" "qa"
    (as_string (Ta_core.Dashboard_interaction.selected_agent state));
  let state = Ta_core.Dashboard_interaction.handle_key state "Down" in
  Alcotest.(check string)
    "wrap agent" "lead"
    (as_string (Ta_core.Dashboard_interaction.selected_agent state))

let expect_workspace_navigation () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "w" in
  let state = Ta_core.Dashboard_interaction.handle_key state "Down" in
  Alcotest.(check string)
    "next workspace" "docs"
    (as_workspace (Ta_core.Dashboard_interaction.selected_workspace state));
  Alcotest.(check string)
    "workspace first agent" "writer"
    (as_string (Ta_core.Dashboard_interaction.selected_agent state))

let expect_tab_cycles_focus () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  Alcotest.(check bool)
    "initial agents" true
    (match Ta_core.Dashboard_interaction.focus state with
    | Ta_core.Dashboard_interaction.Agents -> true
    | Workspaces | Pipeline -> false);
  let state = Ta_core.Dashboard_interaction.handle_key state "Tab" in
  Alcotest.(check bool)
    "pipeline" true
    (match Ta_core.Dashboard_interaction.focus state with
    | Ta_core.Dashboard_interaction.Pipeline -> true
    | Workspaces | Agents -> false);
  let state = Ta_core.Dashboard_interaction.handle_key state "Tab" in
  Alcotest.(check bool)
    "workspaces" true
    (match Ta_core.Dashboard_interaction.focus state with
    | Ta_core.Dashboard_interaction.Workspaces -> true
    | Agents | Pipeline -> false);
  let state = Ta_core.Dashboard_interaction.handle_key state "Tab" in
  Alcotest.(check bool)
    "agents" true
    (match Ta_core.Dashboard_interaction.focus state with
    | Ta_core.Dashboard_interaction.Agents -> true
    | Workspaces | Pipeline -> false)

let expect_pipeline_navigation () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "p" in
  let state = Ta_core.Dashboard_interaction.handle_key state "Down" in
  Alcotest.(check bool)
    "focus" true
    (match Ta_core.Dashboard_interaction.focus state with
    | Ta_core.Dashboard_interaction.Pipeline -> true
    | Workspaces | Agents -> false);
  Alcotest.(check string)
    "next pipeline agent" "qa"
    (as_string (Ta_core.Dashboard_interaction.selected_agent state));
  let state = Ta_core.Dashboard_interaction.handle_key state "Down" in
  Alcotest.(check string)
    "next pipeline workspace" "docs"
    (as_workspace (Ta_core.Dashboard_interaction.selected_workspace state));
  Alcotest.(check string)
    "next pipeline agent" "writer"
    (as_string (Ta_core.Dashboard_interaction.selected_agent state))

let expect_pipeline_edge_navigation () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "p" in
  let state = Ta_core.Dashboard_interaction.handle_key state "Right" in
  Alcotest.(check bool)
    "focus" true
    (match Ta_core.Dashboard_interaction.focus state with
    | Ta_core.Dashboard_interaction.Pipeline -> true
    | Workspaces | Agents -> false);
  Alcotest.(check string)
    "target agent" "qa"
    (as_string (Ta_core.Dashboard_interaction.selected_agent state));
  Alcotest.(check bool)
    "edge selected" true
    (Option.is_some (Ta_core.Dashboard_interaction.selected_edge state));
  let rendered =
    Ta_core.Dashboard_interaction.render ~now:45.0 ~width:100 state
  in
  Alcotest.(check bool)
    "edge marker" true
    (contains_substring ~needle:"> ACL fixture/lead -> read qa | write qa"
       rendered);
  Alcotest.(check bool)
    "target preview" true
    (contains_substring ~needle:"Preview: fixture/qa" rendered)

let expect_agent_navigation_clears_edge_focus () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "p" in
  let state = Ta_core.Dashboard_interaction.handle_key state "Right" in
  Alcotest.(check bool)
    "edge selected" true
    (Option.is_some (Ta_core.Dashboard_interaction.selected_edge state));
  let state = Ta_core.Dashboard_interaction.handle_key state "a" in
  let state = Ta_core.Dashboard_interaction.handle_key state "Down" in
  Alcotest.(check bool)
    "edge cleared" true
    (Option.is_none (Ta_core.Dashboard_interaction.selected_edge state))

let expect_refresh_preserves_selection () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "Down" in
  let state = Ta_core.Dashboard_interaction.handle_key state "r" in
  Alcotest.(check bool)
    "refresh requested" true
    (Ta_core.Dashboard_interaction.refresh_requested state);
  let refreshed = Ta_core.Dashboard_interaction.refresh (dashboard ()) state in
  Alcotest.(check bool)
    "refresh cleared" false
    (Ta_core.Dashboard_interaction.refresh_requested refreshed);
  Alcotest.(check bool)
    "fresh" true
    (match Ta_core.Dashboard_interaction.refresh_status refreshed with
    | Ta_core.Dashboard_interaction.Fresh -> true
    | Refreshing | Stale _ -> false);
  Alcotest.(check string)
    "agent preserved" "qa"
    (as_string (Ta_core.Dashboard_interaction.selected_agent refreshed))

let expect_refresh_preserves_pipeline_focus () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "p" in
  let state = Ta_core.Dashboard_interaction.handle_key state "Down" in
  let state = Ta_core.Dashboard_interaction.handle_key state "r" in
  let refreshed = Ta_core.Dashboard_interaction.refresh (dashboard ()) state in
  Alcotest.(check bool)
    "pipeline focus" true
    (match Ta_core.Dashboard_interaction.focus refreshed with
    | Ta_core.Dashboard_interaction.Pipeline -> true
    | Workspaces | Agents -> false);
  Alcotest.(check string)
    "agent preserved" "qa"
    (as_string (Ta_core.Dashboard_interaction.selected_agent refreshed))

let expect_refresh_preserves_pipeline_edge () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "p" in
  let state = Ta_core.Dashboard_interaction.handle_key state "Right" in
  let state = Ta_core.Dashboard_interaction.handle_key state "r" in
  let refreshed = Ta_core.Dashboard_interaction.refresh (dashboard ()) state in
  Alcotest.(check bool)
    "edge preserved" true
    (Option.is_some (Ta_core.Dashboard_interaction.selected_edge refreshed));
  Alcotest.(check string)
    "target preserved" "qa"
    (as_string (Ta_core.Dashboard_interaction.selected_agent refreshed))

let expect_refresh_drops_missing_pipeline_edge () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "p" in
  let state = Ta_core.Dashboard_interaction.handle_key state "Right" in
  let refreshed =
    Ta_core.Dashboard_interaction.refresh (dashboard_without_links ()) state
  in
  Alcotest.(check bool)
    "edge dropped" true
    (Option.is_none (Ta_core.Dashboard_interaction.selected_edge refreshed))

let expect_refresh_failure_renders_stale () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "r" in
  Alcotest.(check bool)
    "refresh requested" true
    (Ta_core.Dashboard_interaction.refresh_requested state);
  Alcotest.(check bool)
    "refreshing" true
    (match Ta_core.Dashboard_interaction.refresh_status state with
    | Ta_core.Dashboard_interaction.Refreshing -> true
    | Fresh | Stale _ -> false);
  let state =
    Ta_core.Dashboard_interaction.refresh_failed "socket unavailable" state
  in
  Alcotest.(check bool)
    "request cleared" false
    (Ta_core.Dashboard_interaction.refresh_requested state);
  Alcotest.(check bool)
    "stale" true
    (match Ta_core.Dashboard_interaction.refresh_status state with
    | Ta_core.Dashboard_interaction.Stale "socket unavailable" -> true
    | Fresh | Refreshing | Stale _ -> false);
  let rendered =
    Ta_core.Dashboard_interaction.render ~now:45.0 ~width:90 state
  in
  Alcotest.(check bool)
    "stale banner" true
    (contains_substring ~needle:"Refresh: STALE - socket unavailable" rendered);
  Alcotest.(check bool)
    "last refresh" true
    (contains_substring ~needle:"Last refresh: 3.0s ago" rendered)

let expect_render_uses_selection () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "Down" in
  let rendered =
    Ta_core.Dashboard_interaction.render ~now:45.0 ~width:90 state
  in
  Alcotest.(check bool)
    "selected preview" true
    (contains_substring ~needle:"Preview: fixture/qa" rendered);
  Alcotest.(check bool)
    "last refresh" true
    (contains_substring ~needle:"Last refresh: 3.0s ago" rendered)

let () =
  Alcotest.run "dashboard-interaction"
    [
      ( "dashboard_interaction",
        [
          Alcotest.test_case "initial selection" `Quick expect_initial_selection;
          Alcotest.test_case "agent navigation" `Quick expect_agent_navigation;
          Alcotest.test_case "workspace navigation" `Quick
            expect_workspace_navigation;
          Alcotest.test_case "tab cycles focus" `Quick expect_tab_cycles_focus;
          Alcotest.test_case "pipeline navigation" `Quick
            expect_pipeline_navigation;
          Alcotest.test_case "pipeline edge navigation" `Quick
            expect_pipeline_edge_navigation;
          Alcotest.test_case "agent navigation clears edge focus" `Quick
            expect_agent_navigation_clears_edge_focus;
          Alcotest.test_case "refresh preserves selection" `Quick
            expect_refresh_preserves_selection;
          Alcotest.test_case "refresh preserves pipeline focus" `Quick
            expect_refresh_preserves_pipeline_focus;
          Alcotest.test_case "refresh preserves pipeline edge" `Quick
            expect_refresh_preserves_pipeline_edge;
          Alcotest.test_case "refresh drops missing pipeline edge" `Quick
            expect_refresh_drops_missing_pipeline_edge;
          Alcotest.test_case "refresh failure renders stale" `Quick
            expect_refresh_failure_renders_stale;
          Alcotest.test_case "render uses selection" `Quick
            expect_render_uses_selection;
        ] );
    ]
