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
        {"name": "docs", "roster_agent": "documenter", "command": ["codex"]}
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

let store () =
  match Ta_core.State_store.of_config (parsed_config ()) with
  | Ok store -> store
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let workspace = Ta_core.Id.Workspace.unsafe_of_string "fixture"
let lead = Ta_core.Id.Agent.unsafe_of_string "lead"
let qa = Ta_core.Id.Agent.unsafe_of_string "qa"
let lead_pane = Ta_core.Id.Pane.unsafe_of_string "%11"
let qa_pane = Ta_core.Id.Pane.unsafe_of_string "%12"

let lead_identity =
  Ta_core.Tmux.unsafe_pane_identity ~session_id:"$1" ~window_id:"@1"

let qa_identity =
  Ta_core.Tmux.unsafe_pane_identity ~session_id:"$1" ~window_id:"@2"

let attach_pane store agent pane identity =
  match
    Ta_core.State_store.attach_pane ~identity store ~workspace ~agent ~pane
      ~actor:None
  with
  | Ok store -> store
  | Error message -> Alcotest.fail message

let store_with_panes () =
  store () |> fun store ->
  attach_pane store lead lead_pane lead_identity |> fun store ->
  attach_pane store qa qa_pane qa_identity

let store_with_lead_pane () =
  store () |> fun store -> attach_pane store lead lead_pane lead_identity

let tmux_error output =
  {
    Ta_core.Tmux.argv = [ "tmux"; "capture-pane" ];
    status = Unix.WEXITED 1;
    output;
  }

let runner = function
  | Ta_core.Tmux.Display_pane_identity target ->
      if
        String.equal
          (Ta_core.Tmux.target_to_string target)
          (Ta_core.Id.Pane.to_string lead_pane)
      then Ok "$1\t@1\n"
      else Ok "$1\t@2\n"
  | Ta_core.Tmux.Display_session_name _ -> Ok "ta-fixture\n"
  | Ta_core.Tmux.Capture_pane { target; lines } ->
      Alcotest.(check int) "capture lines" 5 lines;
      if
        String.equal
          (Ta_core.Tmux.target_to_string target)
          (Ta_core.Id.Pane.to_string lead_pane)
      then Ok "lead-ready\nworking\n\n  \n"
      else Error (tmux_error "can't find pane")
  | command ->
      Alcotest.fail
        ("unexpected tmux command: " ^ Ta_core.Tmux.command_line command)

let mismatch_runner = function
  | Ta_core.Tmux.Display_pane_identity _ -> Ok "$9\t@9\n"
  | command ->
      Alcotest.fail
        ("unexpected tmux command after mismatch: "
        ^ Ta_core.Tmux.command_line command)

let agent_names snapshot =
  snapshot.Ta_core.Runtime_snapshot.workspaces
  |> List.concat_map (fun (workspace : Ta_core.Runtime_snapshot.workspace) ->
      workspace.agents)
  |> List.map (fun (agent : Ta_core.Runtime_snapshot.agent) ->
      Ta_core.Id.Agent.to_string agent.name)

let lead_preview snapshot =
  match snapshot.Ta_core.Runtime_snapshot.workspaces with
  | [ { agents = lead_agent :: _; _ } ] -> lead_agent.preview
  | _ -> Alcotest.fail "unexpected lead preview shape"

let preview_size preview =
  List.fold_left (fun size line -> size + String.length line) 0 preview

let expect_collects_pane_previews () =
  let snapshot =
    Ta_core.Runtime_snapshot.collect ~now:42.0 ~lines:5 ~runner
      (store_with_panes ())
  in
  Alcotest.(check string)
    "summary" "TA runtime snapshot: 1 workspace(s), 3 agent(s), 1 live pane(s)"
    (Ta_core.Runtime_snapshot.summarize snapshot);
  Alcotest.(check (list string))
    "agents" [ "lead"; "qa"; "docs" ] (agent_names snapshot);
  match snapshot.workspaces with
  | [ (workspace : Ta_core.Runtime_snapshot.workspace) ] -> (
      match workspace.agents with
      | [ lead_agent; qa_agent; docs_agent ] ->
          Alcotest.(check (list string))
            "lead preview"
            [ "lead-ready"; "working" ]
            lead_agent.preview;
          Alcotest.(check bool)
            "lead live" true
            (match lead_agent.pane_state with
            | Ta_core.Runtime_snapshot.Live -> true
            | _ -> false);
          Alcotest.(check bool)
            "qa missing" true
            (match qa_agent.pane_state with
            | Ta_core.Runtime_snapshot.Missing message ->
                String.contains message 'c'
                && Option.equal Ta_core.Id.Pane.equal qa_agent.pane
                     (Some qa_pane)
            | _ -> false);
          Alcotest.(check bool)
            "docs unattached" true
            (match docs_agent.pane_state with
            | Ta_core.Runtime_snapshot.Unattached ->
                Option.is_none docs_agent.pane
            | _ -> false)
      | _ -> Alcotest.fail "unexpected agents")
  | _ -> Alcotest.fail "unexpected workspaces"

let expect_json_shape () =
  let snapshot =
    Ta_core.Runtime_snapshot.collect ~now:42.0 ~lines:5 ~runner
      (store_with_panes ())
  in
  let json = Ta_core.Runtime_snapshot.to_yojson snapshot in
  let field name = function
    | `Assoc fields -> (
        match List.assoc_opt name fields with
        | Some value -> value
        | None -> Alcotest.fail ("missing field: " ^ name))
    | _ -> Alcotest.fail ("expected object: " ^ name)
  in
  let as_string label = function
    | `String value -> value
    | _ -> Alcotest.fail ("expected string: " ^ label)
  in
  let as_float label = function
    | `Float value -> value
    | `Int value -> float_of_int value
    | _ -> Alcotest.fail ("expected float: " ^ label)
  in
  let as_list label = function
    | `List values -> values
    | _ -> Alcotest.fail ("expected list: " ^ label)
  in
  Alcotest.(check string)
    "version" "0.1.0"
    (json |> field "version" |> as_string "version");
  Alcotest.(check (float 0.0))
    "captured_at" 42.0
    (json |> field "captured_at" |> as_float "captured_at");
  let workspace =
    match json |> field "workspaces" |> as_list "workspaces" with
    | [ workspace ] -> workspace
    | _ -> Alcotest.fail "expected one workspace"
  in
  let agent name =
    workspace |> field "agents" |> as_list "agents"
    |> List.find_opt (fun agent ->
        String.equal name (agent |> field "name" |> as_string "name"))
    |> function
    | Some agent -> agent
    | None -> Alcotest.fail ("missing agent: " ^ name)
  in
  let lead = agent "lead" in
  Alcotest.(check string)
    "lead pane" "%11"
    (lead |> field "pane" |> as_string "pane");
  Alcotest.(check string)
    "lead expected session" "ta-fixture"
    (lead |> field "expected_session" |> as_string "expected_session");
  Alcotest.(check string)
    "lead session id" "$1"
    (lead |> field "pane_identity" |> field "session_id"
   |> as_string "session_id");
  Alcotest.(check string)
    "lead window id" "@1"
    (lead |> field "pane_identity" |> field "window_id" |> as_string "window_id");
  Alcotest.(check string)
    "lead live" "live"
    (lead |> field "pane_state" |> field "kind" |> as_string "kind");
  Alcotest.(check (list string))
    "lead preview"
    [ "lead-ready"; "working" ]
    (lead |> field "preview" |> as_list "preview"
    |> List.map (as_string "preview line"));
  let qa = agent "qa" in
  Alcotest.(check string)
    "qa missing" "missing"
    (qa |> field "pane_state" |> field "kind" |> as_string "kind");
  Alcotest.(check bool)
    "qa missing message" true
    (String.contains
       (qa |> field "pane_state" |> field "message" |> as_string "message")
       'c');
  let docs = agent "docs" in
  Alcotest.(check bool)
    "docs pane null" true
    (match field "pane" docs with `Null -> true | _ -> false);
  Alcotest.(check string)
    "docs unattached" "unattached"
    (docs |> field "pane_state" |> field "kind" |> as_string "kind")

let expect_rejects_identity_mismatch () =
  let snapshot =
    Ta_core.Runtime_snapshot.collect ~now:42.0 ~lines:5 ~runner:mismatch_runner
      (store_with_panes ())
  in
  match snapshot.workspaces with
  | [ { agents = lead_agent :: _; _ } ] -> (
      match lead_agent.pane_state with
      | Ta_core.Runtime_snapshot.Missing message ->
          Alcotest.(check bool)
            "mismatch message" true
            (String.contains message 'e')
      | _ -> Alcotest.fail "expected missing pane after identity mismatch")
  | _ -> Alcotest.fail "unexpected snapshot"

let preview_runner output = function
  | Ta_core.Tmux.Display_pane_identity _ -> Ok "$1\t@1\n"
  | Ta_core.Tmux.Capture_pane _ -> Ok output
  | command ->
      Alcotest.fail
        ("unexpected tmux command: " ^ Ta_core.Tmux.command_line command)

let expect_truncates_long_preview_line () =
  let long_line =
    String.make (Ta_core.Runtime_snapshot.max_preview_line_bytes + 100) 'x'
  in
  let snapshot =
    Ta_core.Runtime_snapshot.collect ~now:42.0 ~lines:5
      ~runner:(preview_runner long_line) (store_with_lead_pane ())
  in
  match lead_preview snapshot with
  | [ line ] ->
      Alcotest.(check int)
        "line byte cap" Ta_core.Runtime_snapshot.max_preview_line_bytes
        (String.length line);
      Alcotest.(check bool) "line marker" true (String.contains line '[')
  | _ -> Alcotest.fail "expected one truncated preview line"

let expect_caps_total_preview_bytes () =
  let line = String.make 1_000 'x' in
  let output = List.init 300 (fun _ -> line) |> String.concat "\n" in
  let snapshot =
    Ta_core.Runtime_snapshot.collect ~now:42.0
      ~lines:Ta_core.Runtime_snapshot.max_preview_lines
      ~runner:(preview_runner output) (store_with_lead_pane ())
  in
  let preview = lead_preview snapshot in
  Alcotest.(check bool)
    "total preview byte cap" true
    (preview_size preview <= Ta_core.Runtime_snapshot.max_preview_bytes);
  Alcotest.(check bool) "keeps bounded preview" true (preview_size preview > 0)

let () =
  Alcotest.run "runtime-snapshot"
    [
      ( "runtime_snapshot",
        [
          Alcotest.test_case "collects pane previews" `Quick
            expect_collects_pane_previews;
          Alcotest.test_case "json shape" `Quick expect_json_shape;
          Alcotest.test_case "rejects identity mismatch" `Quick
            expect_rejects_identity_mismatch;
          Alcotest.test_case "truncates long preview line" `Quick
            expect_truncates_long_preview_line;
          Alcotest.test_case "caps total preview bytes" `Quick
            expect_caps_total_preview_bytes;
        ] );
    ]
