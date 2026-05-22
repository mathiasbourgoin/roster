let workspace value = Ta_core.Id.Workspace.unsafe_of_string value
let agent value = Ta_core.Id.Agent.unsafe_of_string value

let pipeline_role =
  match
    Ta_core.Roster_pipeline_role.parse_string
      {|---
pipeline_role:
  triggered_by: qa report
  receives: qa input
  produces: qa output
  human_gate: none
---
|}
  with
  | Some role -> role
  | None -> Alcotest.fail "expected pipeline role"

let metadata pipeline_role : Ta_core.Dashboard_model.roster_metadata =
  {
    display_name = Some "Tech Lead";
    description = None;
    domain = [ "management" ];
    tags = [];
    model = None;
    complexity = None;
    compatible_with = [];
    version = None;
    author = None;
    isolation = None;
    pipeline_role;
    source = Some "local";
  }

let agent_model ?(metadata = None) ?(readable = []) ?(writable = []) name
    roster_agent =
  {
    Ta_core.Dashboard_model.workspace = workspace "fixture";
    name = agent name;
    roster_agent;
    roster_metadata = metadata;
    status = Ta_core.State_store.Not_started;
    pane = None;
    runtime_state = Ta_core.Dashboard_model.Unattached;
    preview = [];
    outgoing =
      { readable = List.map agent readable; writable = List.map agent writable };
  }

let model () =
  let lead =
    agent_model
      ~metadata:(Some (metadata (Some pipeline_role)))
      ~readable:[ "qa"; "hidden" ] ~writable:[ "qa" ] "lead" "tech-lead"
  in
  let qa = agent_model "qa" "qa" in
  let writer =
    { (agent_model "writer" "documenter") with workspace = workspace "docs" }
  in
  {
    Ta_core.Dashboard_model.captured_at = Some 42.0;
    workspaces =
      [
        {
          id = workspace "fixture";
          label = "Fixture";
          root = ".";
          tmux_session = None;
          active_view = Ta_core.Id.View.unsafe_of_string "agents";
          agents = [ lead; qa ];
          link_count = 2;
          live_count = 0;
          blocked_count = 0;
          failed_count = 0;
        };
        {
          id = workspace "docs";
          label = "Docs";
          root = ".";
          tmux_session = None;
          active_view = Ta_core.Id.View.unsafe_of_string "agents";
          agents = [ writer ];
          link_count = 0;
          live_count = 0;
          blocked_count = 0;
          failed_count = 0;
        };
      ];
    totals =
      {
        workspace_count = 2;
        agent_count = 3;
        live_count = 0;
        blocked_count = 0;
        failed_count = 0;
      };
  }

let node_label node =
  Printf.sprintf "%s/%s"
    (Ta_core.Id.Workspace.to_string
       (Ta_core.Dashboard_topology.node_workspace
          node.Ta_core.Dashboard_topology.id))
    (Ta_core.Id.Agent.to_string
       (Ta_core.Dashboard_topology.node_agent node.Ta_core.Dashboard_topology.id))

let expect_nodes_in_display_order () =
  let topology = Ta_core.Dashboard_model.topology (model ()) in
  Alcotest.(check (list string))
    "nodes"
    [ "fixture/lead"; "fixture/qa"; "docs/writer" ]
    (List.map node_label topology.nodes)

let expect_declared_acl_edges_are_filtered () =
  let topology = Ta_core.Dashboard_model.topology (model ()) in
  match topology.declared_acl_edges with
  | [ edge ] ->
      Alcotest.(check string)
        "from" "lead"
        (Ta_core.Id.Agent.to_string edge.from_agent);
      Alcotest.(check (list string))
        "readable" [ "qa" ]
        (List.map Ta_core.Id.Agent.to_string edge.readable);
      Alcotest.(check (list string))
        "writable" [ "qa" ]
        (List.map Ta_core.Id.Agent.to_string edge.writable)
  | _ -> Alcotest.fail "expected one visible ACL edge"

let expect_pipeline_role_does_not_infer_edges () =
  let topology = Ta_core.Dashboard_model.topology (model ()) in
  match topology.nodes with
  | lead :: _ ->
      Alcotest.(check string)
        "contract" "contract"
        (Ta_core.Dashboard_topology.contract_to_string lead.contract);
      Alcotest.(check int) "edges" 1 (List.length topology.declared_acl_edges)
  | [] -> Alcotest.fail "expected nodes"

let node_to_string node_id =
  Printf.sprintf "%s/%s"
    (Ta_core.Id.Workspace.to_string
       (Ta_core.Dashboard_topology.node_workspace node_id))
    (Ta_core.Id.Agent.to_string (Ta_core.Dashboard_topology.node_agent node_id))

let expect_move_wraps_visible_nodes () =
  let topology = Ta_core.Dashboard_model.topology (model ()) in
  let first = Ta_core.Dashboard_topology.move `Next ~selected:None topology in
  Alcotest.(check string)
    "first" "fixture/lead"
    (Option.map node_to_string first |> Option.value ~default:"-");
  let next = Ta_core.Dashboard_topology.move `Next ~selected:first topology in
  Alcotest.(check string)
    "next" "fixture/qa"
    (Option.map node_to_string next |> Option.value ~default:"-");
  let previous =
    Ta_core.Dashboard_topology.move `Previous ~selected:first topology
  in
  Alcotest.(check string)
    "previous wraps" "docs/writer"
    (Option.map node_to_string previous |> Option.value ~default:"-")

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let expect_render_marks_selected_focus () =
  let topology = Ta_core.Dashboard_model.topology (model ()) in
  let selected =
    Ta_core.Dashboard_topology.node_id ~workspace:(workspace "fixture")
      ~agent:(agent "qa")
  in
  let rendered =
    Ta_core.Dashboard_topology.render ~width:100 ~focused:true
      ~selected:(Some selected) topology
    |> String.concat "\n"
  in
  Alcotest.(check bool)
    "focused title" true
    (contains_substring ~needle:"Pipeline overview [focus]" rendered);
  Alcotest.(check bool)
    "selected qa" true
    (contains_substring ~needle:"> fixture   qa" rendered);
  Alcotest.(check bool)
    "edge categories" true
    (contains_substring ~needle:"Edge categories: declared-acl" rendered)

let () =
  Alcotest.run "dashboard-topology"
    [
      ( "dashboard_topology",
        [
          Alcotest.test_case "nodes in display order" `Quick
            expect_nodes_in_display_order;
          Alcotest.test_case "declared acl edges are filtered" `Quick
            expect_declared_acl_edges_are_filtered;
          Alcotest.test_case "pipeline role does not infer edges" `Quick
            expect_pipeline_role_does_not_infer_edges;
          Alcotest.test_case "move wraps visible nodes" `Quick
            expect_move_wraps_visible_nodes;
          Alcotest.test_case "render marks selected focus" `Quick
            expect_render_marks_selected_focus;
        ] );
    ]
