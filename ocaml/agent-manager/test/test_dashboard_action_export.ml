let agent value = Ta_core.Id.Agent.unsafe_of_string value

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
        {"name": "ops", "roster_agent": "qa", "command": ["codex"]},
        {"name": "writer", "roster_agent": "documenter", "command": ["codex"]}
      ],
      "links": [
        {"from": "lead", "to": "qa", "permissions": ["read", "write"], "reason": "qa handoff"},
        {"from": "lead", "to": "ops", "permissions": ["read"], "reason": "ops handoff"},
        {"from": "lead", "to": "writer", "permissions": ["write"], "reason": "writer handoff"}
      ]
    }
  ]
}
|}

let fail_json message = Alcotest.fail ("invalid JSON: " ^ message)

let fields json =
  match json with `Assoc fields -> fields | _ -> fail_json "expected object"

let field name json =
  match List.assoc_opt name (fields json) with
  | Some value -> value
  | None -> fail_json ("missing field " ^ name)

let as_string name = function
  | `String value -> value
  | _ -> fail_json (name ^ " must be a string")

let as_bool name = function
  | `Bool value -> value
  | _ -> fail_json (name ^ " must be a bool")

let as_int name = function
  | `Int value -> value
  | _ -> fail_json (name ^ " must be an int")

let as_list name = function
  | `List values -> values
  | _ -> fail_json (name ^ " must be a list")

let parse_config () =
  match Ta_core.Workspace_config.parse_string config with
  | Ok config -> config
  | Error errors ->
      errors
      |> List.map Ta_core.Workspace_config.error_to_string
      |> String.concat "\n" |> Alcotest.fail

let store () =
  match Ta_core.State_store.of_config (parse_config ()) with
  | Ok store -> store
  | Error errors ->
      errors
      |> List.map Ta_core.Workspace_config.error_to_string
      |> String.concat "\n" |> Alcotest.fail

let dashboard () =
  let store = store () in
  let runtime = Ta_core.Runtime_snapshot.collect ~now:42.0 store in
  Ta_core.Dashboard_model.of_state_runtime store runtime

let replay keys =
  List.fold_left Ta_core.Dashboard_interaction.handle_key
    (Ta_core.Dashboard_interaction.init (dashboard ()))
    keys

let export_json ?actor ?lines state =
  Ta_core.Dashboard_action_export.of_interaction ?actor ?lines state
  |> Ta_core.Dashboard_action_export.to_yojson

let focused_edge ?actor ?lines keys = replay keys |> export_json ?actor ?lines
let actions affordance = affordance |> field "actions" |> as_list "actions"
let action_intent action = field "intent" action

let action_kind action =
  action |> action_intent |> field "kind" |> as_string "intent.kind"

let has_action ?agent ?to_agent kind actions =
  List.exists
    (fun action ->
      let intent = action_intent action in
      let matches_agent =
        match agent with
        | None -> true
        | Some expected -> (
            match List.assoc_opt "agent" (fields intent) with
            | Some value -> String.equal expected (as_string "agent" value)
            | None -> false)
      in
      let matches_to_agent =
        match to_agent with
        | None -> true
        | Some expected -> (
            match List.assoc_opt "to_agent" (fields intent) with
            | Some value -> String.equal expected (as_string "to_agent" value)
            | None -> false)
      in
      String.equal kind (action_kind action)
      && matches_agent && matches_to_agent)
    actions

let target_agent target =
  target |> field "endpoint" |> field "agent" |> as_string "endpoint.agent"

let find_target name affordance =
  match
    affordance |> field "targets" |> as_list "targets"
    |> List.find_opt (fun target -> String.equal name (target_agent target))
  with
  | Some target -> target
  | None -> Alcotest.fail ("missing target " ^ name)

let expect_no_focused_edge_exports_null () =
  let json = export_json (replay []) in
  Alcotest.(check string)
    "version" "0.1.0"
    (json |> field "version" |> as_string "version");
  Alcotest.(check string)
    "focus" "agents"
    (json |> field "focus" |> as_string "focus");
  Alcotest.(check string)
    "refresh" "fresh"
    (json |> field "refresh_status" |> field "kind"
    |> as_string "refresh_status.kind");
  Alcotest.(check bool)
    "selected edge null" true
    (match field "selected_edge" json with `Null -> true | _ -> false);
  Alcotest.(check bool)
    "affordance null" true
    (match field "affordance" json with `Null -> true | _ -> false)

let expect_focused_edge_exports_actions () =
  let json = focused_edge ~actor:(agent "lead") [ "p"; "Right"; "]" ] in
  let affordance = field "affordance" json in
  let selected_edge = field "selected_edge" json in
  let selected_target = field "selected_target" json in
  Alcotest.(check string)
    "focus" "pipeline"
    (json |> field "focus" |> as_string "focus");
  Alcotest.(check string)
    "edge source" "lead"
    (selected_edge |> field "from_agent" |> as_string "from_agent");
  Alcotest.(check string)
    "selected target" "qa"
    (selected_target |> field "agent" |> as_string "agent");
  Alcotest.(check string)
    "source agent" "lead"
    (affordance |> field "source" |> field "agent" |> as_string "source.agent");
  let qa = find_target "qa" affordance in
  Alcotest.(check bool)
    "qa selected" true
    (qa |> field "selected" |> as_bool "selected");
  let actions = actions affordance in
  Alcotest.(check bool)
    "source read" true
    (has_action ~agent:"lead" "runtime-snapshot" actions);
  Alcotest.(check bool)
    "target read" true
    (has_action ~agent:"qa" "runtime-snapshot" actions);
  Alcotest.(check bool)
    "target focus" true
    (has_action ~agent:"qa" "focus-pane" actions);
  Alcotest.(check bool)
    "target write" true
    (has_action ~to_agent:"qa" "future-agent-message" actions)

let expect_lines_flow_into_read_intents () =
  let json =
    focused_edge ~actor:(agent "lead") ~lines:3 [ "p"; "Right"; "]" ]
  in
  let actions = json |> field "affordance" |> actions in
  let target_read =
    match
      actions
      |> List.find_opt (fun action ->
          has_action ~agent:"qa" "runtime-snapshot" [ action ])
    with
    | Some action -> action
    | None -> Alcotest.fail "missing qa read action"
  in
  Alcotest.(check int)
    "lines" 3
    (target_read |> action_intent |> field "lines" |> as_int "lines")

let expect_non_source_actor_suppresses_write_intent () =
  let json = focused_edge ~actor:(agent "qa") [ "p"; "Right"; "]" ] in
  let actions = json |> field "affordance" |> actions in
  Alcotest.(check bool)
    "write hidden" false
    (has_action ~to_agent:"qa" "future-agent-message" actions)

let expect_write_only_target_exports_no_read_or_focus () =
  let json = focused_edge ~actor:(agent "lead") [ "p"; "Right"; "]"; "]" ] in
  let selected_target = field "selected_target" json in
  let actions = json |> field "affordance" |> actions in
  Alcotest.(check string)
    "selected write target" "writer"
    (selected_target |> field "agent" |> as_string "agent");
  Alcotest.(check bool)
    "writer read hidden" false
    (has_action ~agent:"writer" "runtime-snapshot" actions);
  Alcotest.(check bool)
    "writer focus hidden" false
    (has_action ~agent:"writer" "focus-pane" actions);
  Alcotest.(check bool)
    "writer write visible" true
    (has_action ~to_agent:"writer" "future-agent-message" actions)

let expect_stale_refresh_status_is_exported () =
  let state = replay [ "p"; "Right"; "r" ] in
  let state =
    Ta_core.Dashboard_interaction.refresh_failed "socket offline" state
  in
  let json = export_json state in
  let refresh = field "refresh_status" json in
  Alcotest.(check string)
    "kind" "stale"
    (refresh |> field "kind" |> as_string "refresh_status.kind");
  Alcotest.(check string)
    "message" "socket offline"
    (refresh |> field "message" |> as_string "refresh_status.message")

let () =
  Alcotest.run "dashboard-action-export"
    [
      ( "export",
        [
          Alcotest.test_case "no focused edge" `Quick
            expect_no_focused_edge_exports_null;
          Alcotest.test_case "focused edge actions" `Quick
            expect_focused_edge_exports_actions;
          Alcotest.test_case "read lines" `Quick
            expect_lines_flow_into_read_intents;
          Alcotest.test_case "non-source actor" `Quick
            expect_non_source_actor_suppresses_write_intent;
          Alcotest.test_case "write-only target" `Quick
            expect_write_only_target_exports_no_read_or_focus;
          Alcotest.test_case "stale refresh status" `Quick
            expect_stale_refresh_status_is_exported;
        ] );
    ]
