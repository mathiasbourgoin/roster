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

let store () =
  match Ta_core.State_store.of_config (parse_config ()) with
  | Ok store -> store
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let dashboard () =
  let store = store () in
  let runtime = Ta_core.Runtime_snapshot.collect ~now:42.0 store in
  Ta_core.Dashboard_model.of_state_runtime store runtime

let agent value =
  match Ta_core.Id.Agent.of_string value with
  | Ok value -> value
  | Error message -> Alcotest.fail message

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let line_count value = value |> String.split_on_char '\n' |> List.length

let max_line_length value =
  value |> String.split_on_char '\n'
  |> List.fold_left (fun maximum line -> max maximum (String.length line)) 0

let render_text ?actor ?show_footer ?(width = 100) ?(height = 20) state =
  Ta_core.Dashboard_tui_layout.render ~now:45.0 ?actor ?show_footer ~width
    ~height state
  |> Ta_core.Dashboard_tui_layout.to_text

let expect_selected_agent_layout () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let text = render_text state in
  Alcotest.(check bool)
    "header" true
    (contains_substring ~needle:"TA Dashboard" text);
  Alcotest.(check bool)
    "workspace pane" true
    (contains_substring ~needle:"Workspaces" text);
  Alcotest.(check bool)
    "agent pane" true
    (contains_substring ~needle:"Agents" text);
  Alcotest.(check bool)
    "selected detail" true
    (contains_substring ~needle:"Agent fixture/lead" text);
  Alcotest.(check bool)
    "connections" true
    (contains_substring ~needle:"Connections: read qa | write qa" text);
  Alcotest.(check bool) "bounded" true (line_count text <= 20)

let expect_pipeline_edge_layout () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let state = Ta_core.Dashboard_interaction.handle_key state "p" in
  let state = Ta_core.Dashboard_interaction.handle_key state "Right" in
  let text = render_text ~actor:(agent "lead") state in
  Alcotest.(check bool)
    "pipeline" true
    (contains_substring ~needle:"Pipeline edge" text);
  Alcotest.(check bool)
    "source" true
    (contains_substring ~needle:"Source: lead" text);
  Alcotest.(check bool)
    "target" true
    (contains_substring ~needle:"Selected target: qa" text);
  Alcotest.(check bool)
    "read action" true
    (contains_substring ~needle:"Action: read target preview" text)

let expect_height_clips_layout () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let text = render_text ~height:8 state in
  Alcotest.(check bool) "bounded" true (line_count text <= 8);
  Alcotest.(check bool)
    "footer retained" true
    (contains_substring ~needle:"q quit" text)

let expect_narrow_layout_stays_within_width () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let text = render_text ~width:28 state in
  Alcotest.(check bool) "narrow bounded" true (max_line_length text <= 28)

let expect_footer_can_be_owned_by_driver () =
  let state = Ta_core.Dashboard_interaction.init (dashboard ()) in
  let text = render_text ~show_footer:false state in
  Alcotest.(check bool)
    "footer omitted" false
    (contains_substring ~needle:"q quit" text)

let () =
  Alcotest.run "dashboard-tui-layout"
    [
      ( "layout",
        [
          Alcotest.test_case "selected agent" `Quick
            expect_selected_agent_layout;
          Alcotest.test_case "pipeline edge" `Quick expect_pipeline_edge_layout;
          Alcotest.test_case "height clipping" `Quick expect_height_clips_layout;
          Alcotest.test_case "narrow width" `Quick
            expect_narrow_layout_stays_within_width;
          Alcotest.test_case "driver-owned footer" `Quick
            expect_footer_can_be_owned_by_driver;
        ] );
    ]
