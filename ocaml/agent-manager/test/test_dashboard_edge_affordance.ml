let workspace value = Ta_core.Id.Workspace.unsafe_of_string value
let agent value = Ta_core.Id.Agent.unsafe_of_string value
let pane value = Ta_core.Id.Pane.unsafe_of_string value
let session value = Ta_core.Tmux.unsafe_session_of_string value

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let source : Ta_core.Dashboard_edge_affordance.endpoint =
  {
    workspace = workspace "fixture";
    agent = agent "lead";
    tmux_session = Some (session "ta-fixture");
    pane = Some (pane "%1");
    state = Ta_core.Dashboard_edge_affordance.Live;
    preview_lines = 2;
  }

let target : Ta_core.Dashboard_edge_affordance.target =
  {
    endpoint =
      {
        workspace = workspace "fixture";
        agent = agent "qa";
        tmux_session = Some (session "ta-fixture");
        pane = Some (pane "%2");
        state = Ta_core.Dashboard_edge_affordance.Missing "dead pane";
        preview_lines = 4;
      };
    readable = true;
    writable = true;
  }

let affordance () : Ta_core.Dashboard_edge_affordance.t =
  {
    edge =
      Ta_core.Dashboard_topology.edge_id ~workspace:(workspace "fixture")
        ~from_agent:(agent "lead");
    source;
    targets = [ target ];
    actions =
      [
        Ta_core.Dashboard_edge_affordance.Action
          ( Runtime_snapshot
              {
                workspace = workspace "fixture";
                agent = agent "lead";
                lines = 20;
              },
            "read source preview" );
        Ta_core.Dashboard_edge_affordance.Action
          ( Runtime_snapshot
              {
                workspace = workspace "fixture";
                agent = agent "qa";
                lines = 20;
              },
            "read target preview" );
        Ta_core.Dashboard_edge_affordance.Action
          ( Future_agent_message
              {
                workspace = workspace "fixture";
                from_agent = agent "lead";
                to_agent = agent "qa";
              },
            "draft message handoff" );
      ];
  }

let expect_render_preview () =
  let rendered =
    Ta_core.Dashboard_edge_affordance.render_preview ~width:120 (affordance ())
    |> String.concat "\n"
  in
  Alcotest.(check bool)
    "focused edge" true
    (contains_substring ~needle:"Focused edge: fixture/lead -> fixture/qa"
       rendered);
  Alcotest.(check bool)
    "source metadata" true
    (contains_substring
       ~needle:
         "Edge source: fixture/lead pane %1 session ta-fixture runtime LIVE"
       rendered);
  Alcotest.(check bool)
    "target metadata" true
    (contains_substring
       ~needle:
         "Edge target: fixture/qa pane %2 session ta-fixture runtime MISSING"
       rendered);
  Alcotest.(check bool)
    "target permissions" true
    (contains_substring ~needle:"permissions read,write" rendered);
  Alcotest.(check bool)
    "read action" true
    (contains_substring
       ~needle:
         "Action: read target preview | runtime-snapshot fixture/qa lines 20"
       rendered);
  Alcotest.(check bool)
    "write action" true
    (contains_substring
       ~needle:
         "Action: draft message handoff | future-agent-message fixture/lead -> \
          qa"
       rendered)

let expect_render_preview_respects_width () =
  Ta_core.Dashboard_edge_affordance.render_preview ~width:72 (affordance ())
  |> List.iter (fun line ->
      Alcotest.(check bool)
        ("line width: " ^ line) true
        (String.length line <= 72))

let () =
  Alcotest.run "dashboard-edge-affordance"
    [
      ( "dashboard_edge_affordance",
        [
          Alcotest.test_case "render preview" `Quick expect_render_preview;
          Alcotest.test_case "render preview respects width" `Quick
            expect_render_preview_respects_width;
        ] );
    ]
