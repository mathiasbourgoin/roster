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

let store_of_config_text text =
  match Ta_core.Workspace_config.parse_string text with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config -> (
      match Ta_core.State_store.of_config config with
      | Ok store -> store
      | Error errors ->
          Alcotest.fail
            (String.concat "\n"
               (List.map Ta_core.Workspace_config.error_to_string errors)))

let write_temp_file contents =
  let path, channel = Filename.open_temp_file "ta-dashboard-roster" ".md" in
  Fun.protect
    ~finally:(fun () -> close_out_noerr channel)
    (fun () -> output_string channel contents);
  path

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

let lines_containing ~needle value =
  value |> String.split_on_char '\n' |> List.filter (contains_substring ~needle)

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
    "pipeline section" true
    (contains_substring ~needle:"Pipeline overview" rendered);
  Alcotest.(check bool)
    "acl disclaimer" true
    (contains_substring
       ~needle:"ACL edges (declared links, not inferred workflow order)"
       rendered);
  Alcotest.(check bool)
    "edge categories" true
    (contains_substring
       ~needle:"Edge categories: declared-acl, structured-workflow" rendered);
  Alcotest.(check bool)
    "pipeline acl edge" true
    (contains_substring ~needle:"ACL fixture/lead -> read qa | write qa"
       rendered);
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
    "model": "opus",
    "complexity": "high",
    "compatible_with": ["claude-code"],
    "version": "1.9.0",
    "author": "mathias",
    "isolation": "none",
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
    "lead profile metadata" true
    (contains_substring
       ~needle:"Profile: model opus | complexity high | isolation none" rendered);
  Alcotest.(check bool)
    "lead compatibility metadata" true
    (contains_substring
       ~needle:"Compat: claude-code | version 1.9.0 | author mathias" rendered);
  Alcotest.(check bool)
    "lead role metadata" true
    (contains_substring ~needle:"Role: Coordinates implementation." rendered);
  Alcotest.(check bool)
    "qa metadata" true
    (contains_substring ~needle:"QA/testing" rendered);
  Alcotest.(check bool)
    "lead contract flag" true
    (contains_substring ~needle:"Tech Lead              unknown" rendered);
  Alcotest.(check bool)
    "qa unknown contract flag" true
    (contains_substring ~needle:"QA                     unknown" rendered);
  Alcotest.(check (list string))
    "pipeline overview appears once" [ "Pipeline overview" ]
    (rendered
    |> lines_containing ~needle:"Pipeline overview"
    |> List.map String.trim)

let expect_pipeline_overview_does_not_infer_edges () =
  let frontmatter_path =
    write_temp_file
      {|---
name: tech-lead
display_name: Tech Lead
domain: [management]
pipeline_role:
  triggered_by: qa handoff
  receives: qa report
  produces: qa follow-up
  human_gate: none
---
|}
  in
  Fun.protect
    ~finally:(fun () ->
      try Sys.remove frontmatter_path with Sys_error _ -> ())
    (fun () ->
      let store =
        store_of_config_text
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
    }
  ]
}
|}
      in
      let roster =
        match
          Ta_core.Roster_index.parse_string
            (Printf.sprintf
               {|[{"name": "tech-lead", "display_name": "Tech Lead", "path": %S, "source": "local", "component_type": "agent"}]|}
               (Filename.basename frontmatter_path))
        with
        | Ok roster ->
            Ta_core.Roster_index.enrich_from_frontmatter
              ~root:(Filename.dirname frontmatter_path)
              roster
        | Error errors ->
            Alcotest.fail
              (String.concat "\n"
                 (List.map Ta_core.Roster_index.error_to_string errors))
      in
      let rendered =
        Ta_core.Runtime_snapshot.collect ~now:42.0 store
        |> Ta_core.Dashboard_model.of_state_runtime store
        |> Ta_core.Dashboard_model.enrich_with_roster roster
        |> Ta_core.Dashboard_model.render ~width:120
      in
      Alcotest.(check bool)
        "contract flag" true
        (contains_substring ~needle:"Tech Lead              contract" rendered);
      Alcotest.(check bool)
        "natural language pipeline detail" true
        (contains_substring ~needle:"Receives: qa report" rendered);
      Alcotest.(check bool)
        "no inferred acl edge" false
        (contains_substring ~needle:"ACL fixture/lead ->" rendered))

let expect_pipeline_focused_render_marks_selection () =
  let store = store () in
  let runtime =
    Ta_core.Runtime_snapshot.collect ~now:42.0 ~lines:8 ~runner store
  in
  let model = Ta_core.Dashboard_model.of_state_runtime store runtime in
  let rendered =
    Ta_core.Dashboard_model.render ~width:120
      ~selection:{ workspace = Some workspace; agent = Some qa }
      ~focus:Ta_core.Dashboard_model.Pipeline model
  in
  Alcotest.(check bool)
    "focused title" true
    (contains_substring ~needle:"Pipeline overview [focus]" rendered);
  Alcotest.(check bool)
    "selected pipeline row" true
    (contains_substring ~needle:"> fixture   qa" rendered);
  Alcotest.(check bool)
    "preview follows selected pipeline node" true
    (contains_substring ~needle:"Preview: fixture/qa" rendered)

let expect_focused_edge_affordance_render () =
  let store = store () in
  let runtime =
    Ta_core.Runtime_snapshot.collect ~now:42.0 ~lines:8 ~runner store
  in
  let model = Ta_core.Dashboard_model.of_state_runtime store runtime in
  let hidden = Ta_core.Id.Agent.unsafe_of_string "hidden" in
  let model =
    {
      model with
      workspaces =
        List.map
          (fun (workspace_row : Ta_core.Dashboard_model.workspace) ->
            if Ta_core.Id.Workspace.equal workspace_row.id workspace then
              {
                workspace_row with
                agents =
                  List.map
                    (fun (agent_row : Ta_core.Dashboard_model.agent) ->
                      if Ta_core.Id.Agent.equal agent_row.name lead then
                        {
                          agent_row with
                          outgoing =
                            {
                              readable = hidden :: agent_row.outgoing.readable;
                              writable = hidden :: agent_row.outgoing.writable;
                            };
                        }
                      else agent_row)
                    workspace_row.agents;
              }
            else workspace_row)
          model.workspaces;
    }
  in
  let edge = Ta_core.Dashboard_topology.edge_id ~workspace ~from_agent:lead in
  let affordance =
    match Ta_core.Dashboard_model.edge_affordance ~actor:lead edge model with
    | Some affordance -> affordance
    | None -> Alcotest.fail "expected focused edge affordance"
  in
  Alcotest.(check string)
    "source" "fixture/lead"
    (Ta_core.Dashboard_edge_affordance.endpoint_ref affordance.source);
  (match affordance.targets with
  | [ target ] ->
      Alcotest.(check string)
        "target" "fixture/qa"
        (Ta_core.Dashboard_edge_affordance.endpoint_ref target.endpoint);
      Alcotest.(check bool) "readable" true target.readable;
      Alcotest.(check bool) "writable" true target.writable
  | _ -> Alcotest.fail "expected one edge target");
  Alcotest.(check int) "actions" 3 (List.length affordance.actions);
  let suppressed =
    match Ta_core.Dashboard_model.edge_affordance ~actor:qa edge model with
    | Some affordance -> affordance
    | None -> Alcotest.fail "expected focused edge affordance"
  in
  Alcotest.(check int)
    "non-source actor suppresses write action" 2
    (List.length suppressed.actions);
  let affordance_rendered =
    Ta_core.Dashboard_edge_affordance.render_preview ~width:140 affordance
    |> String.concat "\n"
  in
  Alcotest.(check bool)
    "hidden target redacted" false
    (contains_substring ~needle:"hidden" affordance_rendered);
  let rendered =
    Ta_core.Dashboard_model.render ~width:140 ~lines:3
      ~selection:{ workspace = Some workspace; agent = Some qa }
      ~focus:Ta_core.Dashboard_model.Pipeline ~actor:lead
      ~topology_focus:(Ta_core.Dashboard_topology.Edge edge) model
  in
  Alcotest.(check bool)
    "focused edge" true
    (contains_substring ~needle:"Focused edge: fixture/lead -> fixture/qa"
       rendered);
  Alcotest.(check bool)
    "source metadata" true
    (contains_substring
       ~needle:
         "Edge source: fixture/lead pane %11 session ta-fixture runtime LIVE"
       rendered);
  Alcotest.(check bool)
    "target metadata" true
    (contains_substring
       ~needle:
         "Edge target: fixture/qa pane - session ta-fixture runtime DETACHED"
       rendered);
  Alcotest.(check bool)
    "target action" true
    (contains_substring
       ~needle:
         "Action: read target preview | runtime-snapshot fixture/qa lines 3"
       rendered);
  Alcotest.(check bool)
    "write action" true
    (contains_substring
       ~needle:
         "Action: draft message handoff | future-agent-message fixture/lead -> \
          qa"
       rendered)

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
          Alcotest.test_case "pipeline overview does not infer edges" `Quick
            expect_pipeline_overview_does_not_infer_edges;
          Alcotest.test_case "pipeline focused render marks selection" `Quick
            expect_pipeline_focused_render_marks_selection;
          Alcotest.test_case "focused edge affordance render" `Quick
            expect_focused_edge_affordance_render;
          Alcotest.test_case "render respects width" `Quick
            expect_dashboard_render_respects_width;
        ] );
    ]
