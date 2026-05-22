let valid_config =
  {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "agent-roster",
      "label": "Agent Roster",
      "root": ".",
      "harness_path": ".harness/harness.json",
      "tmux_session": "ta-agent-roster",
      "default_view": "agents",
      "views": [
        {"id": "agents", "label": "Agents"},
        {"id": "qa", "label": "QA"}
      ],
      "agents": [
        {
          "name": "tech-lead",
          "roster_agent": "tech-lead",
          "command": ["codex"],
          "cwd": ".",
          "env": [{"name": "TA_MODE", "value": "lead"}]
        },
        {
          "name": "qa",
          "roster_agent": "qa",
          "command": ["codex"],
          "cwd": "."
        }
      ],
      "links": [
        {
          "from": "tech-lead",
          "to": "qa",
          "permissions": ["read", "write"],
          "reason": "lead routes verification requests"
        }
      ]
    }
  ]
}
|}

let expect_valid () =
  match Ta_core.Workspace_config.parse_string valid_config with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config ->
      Alcotest.(check int) "workspace count" 1 (List.length config.workspaces);
      Alcotest.(check int)
        "validation errors" 0
        (List.length (Ta_core.Workspace_config.validate config))

let expect_invalid_link () =
  let text =
    String.concat "\n"
      [
        "{";
        {|  "version": "0.1.0",|};
        {|  "workspaces": [|};
        {|    {|};
        {|      "id": "w",|};
        {|      "label": "W",|};
        {|      "root": ".",|};
        {|      "tmux_session": "ta-w",|};
        {|      "default_view": "agents",|};
        {|      "views": [{"id": "agents", "label": "Agents"}],|};
        {|      "agents": [{"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]}],|};
        {|      "links": [{"from": "lead", "to": "ghost", "permissions": ["read"], "reason": "test"}]|};
        {|    }|};
        {|  ]|};
        "}";
      ]
  in
  match Ta_core.Workspace_config.parse_string text with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config ->
      let errors = Ta_core.Workspace_config.validate config in
      Alcotest.(check int) "one validation error" 1 (List.length errors)

let expect_duplicate_agent () =
  let text =
    String.concat "\n"
      [
        "{";
        {|  "version": "0.1.0",|};
        {|  "workspaces": [|};
        {|    {|};
        {|      "id": "w",|};
        {|      "label": "W",|};
        {|      "root": ".",|};
        {|      "tmux_session": "ta-w",|};
        {|      "default_view": "agents",|};
        {|      "views": [{"id": "agents", "label": "Agents"}],|};
        {|      "agents": [|};
        {|        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]},|};
        {|        {"name": "lead", "roster_agent": "reviewer", "command": ["codex"]}|};
        {|      ]|};
        {|    }|};
        {|  ]|};
        "}";
      ]
  in
  match Ta_core.Workspace_config.parse_string text with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config ->
      let errors = Ta_core.Workspace_config.validate config in
      Alcotest.(check bool) "has validation error" true (errors <> [])

let expect_invalid_tmux_session () =
  let text =
    String.concat "\n"
      [
        "{";
        {|  "version": "0.1.0",|};
        {|  "workspaces": [|};
        {|    {|};
        {|      "id": "w",|};
        {|      "label": "W",|};
        {|      "root": ".",|};
        {|      "tmux_session": "bad session",|};
        {|      "default_view": "agents",|};
        {|      "views": [{"id": "agents", "label": "Agents"}],|};
        {|      "agents": [{"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]}]|};
        {|    }|};
        {|  ]|};
        "}";
      ]
  in
  match Ta_core.Workspace_config.parse_string text with
  | Ok _ -> Alcotest.fail "invalid tmux session should fail parse"
  | Error errors ->
      Alcotest.(check int) "one parse error" 1 (List.length errors)

let expect_missing_file_is_result () =
  match Ta_core.Workspace_config.load "/tmp/ta-definitely-missing.json" with
  | Ok _ -> Alcotest.fail "missing file should fail"
  | Error errors -> Alcotest.(check int) "one load error" 1 (List.length errors)

let expect_unknown_permission () =
  let text =
    String.concat "\n"
      [
        "{";
        {|  "version": "0.1.0",|};
        {|  "workspaces": [|};
        {|    {|};
        {|      "id": "w",|};
        {|      "label": "W",|};
        {|      "root": ".",|};
        {|      "tmux_session": "ta-w",|};
        {|      "default_view": "agents",|};
        {|      "views": [{"id": "agents", "label": "Agents"}],|};
        {|      "agents": [|};
        {|        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]},|};
        {|        {"name": "qa", "roster_agent": "qa", "command": ["codex"]}|};
        {|      ],|};
        {|      "links": [{"from": "lead", "to": "qa", "permissions": ["admin"], "reason": "test"}]|};
        {|    }|};
        {|  ]|};
        "}";
      ]
  in
  match Ta_core.Workspace_config.parse_string text with
  | Ok _ -> Alcotest.fail "unknown permission should fail parse"
  | Error errors ->
      Alcotest.(check int) "one parse error" 1 (List.length errors)

let expect_roster_index_parse () =
  let text =
    {|
[
  {"name": "tech-lead", "display_name": "Tech Lead", "path": "agents/management/tech-lead.md", "source": "local", "component_type": "agent"},
  {"name": "not-an-agent", "component_type": "skill"}
]
|}
  in
  match Ta_core.Roster_index.parse_string text with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Roster_index.error_to_string errors))
  | Ok roster ->
      Alcotest.(check bool)
        "has tech-lead" true
        (Ta_core.Roster_index.mem_agent roster "tech-lead");
      Alcotest.(check bool)
        "filters skill" false
        (Ta_core.Roster_index.mem_agent roster "not-an-agent")

let expect_unknown_roster_agent () =
  let roster =
    match
      Ta_core.Roster_index.parse_string
        {|[{"name": "tech-lead", "component_type": "agent"}]|}
    with
    | Ok roster -> roster
    | Error _ -> Alcotest.fail "roster should parse"
  in
  match Ta_core.Workspace_config.parse_string valid_config with
  | Error _ -> Alcotest.fail "config should parse"
  | Ok config ->
      let errors =
        Ta_core.Workspace_config.validate_with_roster ~roster config
      in
      Alcotest.(check int) "unknown qa roster agent" 1 (List.length errors)

let expect_bad_id () =
  match Ta_core.Id.Agent.of_string "bad id" with
  | Ok _ -> Alcotest.fail "bad id should be rejected"
  | Error _ -> ()

let parsed_valid_config () =
  match Ta_core.Workspace_config.parse_string valid_config with
  | Ok config -> config
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let valid_store () =
  match Ta_core.State_store.of_config (parsed_valid_config ()) with
  | Ok store -> store
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let check_audit_seq label expected event =
  Alcotest.(check int) label expected event.Ta_core.State_store.seq

let expect_state_store_loads_config () =
  let store = valid_store () in
  Alcotest.(check int)
    "workspace count" 1
    (List.length (Ta_core.State_store.workspaces store));
  Alcotest.(check int)
    "load audit event" 1
    (List.length (Ta_core.State_store.audit_events store));
  match Ta_core.State_store.audit_events store with
  | [ event ] -> (
      check_audit_seq "load seq" 1 event;
      Alcotest.(check bool) "load actor is system" true (event.actor = None);
      match event.kind with
      | Ta_core.State_store.Workspace_loaded -> ()
      | _ -> Alcotest.fail "expected workspace load event")
  | _ -> Alcotest.fail "expected one load event"

let expect_state_store_acl () =
  let store = valid_store () in
  let workspace = Ta_core.Id.Workspace.unsafe_of_string "agent-roster" in
  let lead = Ta_core.Id.Agent.unsafe_of_string "tech-lead" in
  let qa = Ta_core.Id.Agent.unsafe_of_string "qa" in
  Alcotest.(check bool)
    "lead can read qa" true
    (Ta_core.State_store.can_access store ~workspace ~from_agent:lead
       ~to_agent:qa Ta_core.Permission.Read);
  Alcotest.(check bool)
    "qa cannot write lead" false
    (Ta_core.State_store.can_access store ~workspace ~from_agent:qa
       ~to_agent:lead Ta_core.Permission.Write)

let expect_state_store_status_audit () =
  let store = valid_store () in
  let workspace = Ta_core.Id.Workspace.unsafe_of_string "agent-roster" in
  let lead = Ta_core.Id.Agent.unsafe_of_string "tech-lead" in
  match
    Ta_core.State_store.set_agent_status store ~workspace ~agent:lead
      ~status:Ta_core.State_store.Running ~actor:(Some lead)
  with
  | Error message -> Alcotest.fail message
  | Ok updated -> (
      let events = Ta_core.State_store.audit_events updated in
      Alcotest.(check int) "load + status events" 2 (List.length events);
      match events with
      | [ _load; status_event ] -> (
          check_audit_seq "status seq" 2 status_event;
          Alcotest.(check (option string))
            "status actor" (Some "tech-lead")
            (Option.map Ta_core.Id.Agent.to_string status_event.actor);
          match status_event.kind with
          | Ta_core.State_store.Agent_status_changed { agent; before; after } ->
              Alcotest.(check string)
                "status agent" "tech-lead"
                (Ta_core.Id.Agent.to_string agent);
              Alcotest.(check string)
                "before" "not-started"
                (Ta_core.State_store.status_to_string before);
              Alcotest.(check string)
                "after" "running"
                (Ta_core.State_store.status_to_string after)
          | _ -> Alcotest.fail "expected status audit event")
      | _ -> Alcotest.fail "expected load + status events")

let expect_state_store_attach_pane () =
  let store = valid_store () in
  let workspace_id = Ta_core.Id.Workspace.unsafe_of_string "agent-roster" in
  let lead = Ta_core.Id.Agent.unsafe_of_string "tech-lead" in
  let pane = Ta_core.Id.Pane.unsafe_of_string "lead.0" in
  match
    Ta_core.State_store.attach_pane store ~workspace:workspace_id ~agent:lead
      ~pane ~actor:(Some lead)
  with
  | Error message -> Alcotest.fail message
  | Ok updated -> (
      match Ta_core.State_store.find_workspace updated workspace_id with
      | Error message -> Alcotest.fail message
      | Ok workspace -> (
          match Ta_core.State_store.find_agent workspace lead with
          | Error message -> Alcotest.fail message
          | Ok agent -> (
              Alcotest.(check bool)
                "pane attached" true
                (Option.equal Ta_core.Id.Pane.equal agent.pane (Some pane));
              Alcotest.(check int)
                "load + pane events" 2
                (List.length (Ta_core.State_store.audit_events updated));
              match Ta_core.State_store.audit_events updated with
              | [ _load; pane_event ] -> (
                  check_audit_seq "pane seq" 2 pane_event;
                  match pane_event.kind with
                  | Ta_core.State_store.Pane_attached
                      { agent; pane = event_pane } ->
                      Alcotest.(check string)
                        "pane agent" "tech-lead"
                        (Ta_core.Id.Agent.to_string agent);
                      Alcotest.(check string)
                        "pane id" "lead.0"
                        (Ta_core.Id.Pane.to_string event_pane)
                  | _ -> Alcotest.fail "expected pane audit event")
              | _ -> Alcotest.fail "expected load + pane events")))

let expect_state_store_missing_agent () =
  let store = valid_store () in
  let workspace = Ta_core.Id.Workspace.unsafe_of_string "agent-roster" in
  let missing = Ta_core.Id.Agent.unsafe_of_string "missing" in
  match
    Ta_core.State_store.set_agent_status store ~workspace ~agent:missing
      ~status:Ta_core.State_store.Running ~actor:None
  with
  | Ok _ -> Alcotest.fail "missing agent should fail"
  | Error _ -> ()

let expect_state_store_rejects_invalid_config () =
  let text =
    String.concat "\n"
      [
        "{";
        {|  "version": "0.1.0",|};
        {|  "workspaces": [|};
        {|    {|};
        {|      "id": "w",|};
        {|      "label": "W",|};
        {|      "root": ".",|};
        {|      "tmux_session": "ta-w",|};
        {|      "default_view": "missing",|};
        {|      "views": [{"id": "agents", "label": "Agents"}],|};
        {|      "agents": [{"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]}]|};
        {|    }|};
        {|  ]|};
        "}";
      ]
  in
  match Ta_core.Workspace_config.parse_string text with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config -> (
      match Ta_core.State_store.of_config config with
      | Ok _ -> Alcotest.fail "invalid config should be rejected"
      | Error errors ->
          Alcotest.(check int) "validation error" 1 (List.length errors))

let expect_state_store_rejects_unknown_actor () =
  let store = valid_store () in
  let workspace = Ta_core.Id.Workspace.unsafe_of_string "agent-roster" in
  let lead = Ta_core.Id.Agent.unsafe_of_string "tech-lead" in
  let missing = Ta_core.Id.Agent.unsafe_of_string "missing" in
  match
    Ta_core.State_store.set_agent_status store ~workspace ~agent:lead
      ~status:Ta_core.State_store.Running ~actor:(Some missing)
  with
  | Ok _ -> Alcotest.fail "unknown actor should fail"
  | Error _ -> ()

let expect_tmux_argv () =
  let session = Ta_core.Tmux.unsafe_session_of_string "ta-test" in
  Alcotest.(check (list string))
    "capture argv"
    [ "capture-pane"; "-p"; "-t"; "ta-test"; "-S"; "-40" ]
    (Ta_core.Tmux.argv
       (Ta_core.Tmux.Capture_pane { target = session; lines = 40 }))

let expect_tmux_quotes_command () =
  let session = Ta_core.Tmux.unsafe_session_of_string "ta-test" in
  Alcotest.(check (list string))
    "new-session argv"
    [
      "new-session";
      "-d";
      "-s";
      "ta-test";
      "-c";
      "/tmp/project";
      "'printf' 'it'\\''s ok'";
    ]
    (Ta_core.Tmux.argv
       (Ta_core.Tmux.New_detached_session
          {
            session;
            cwd = Some "/tmp/project";
            command = [ "printf"; "it's ok" ];
          }))

let () =
  Alcotest.run "ta-core"
    [
      ( "workspace_config",
        [
          Alcotest.test_case "valid config" `Quick expect_valid;
          Alcotest.test_case "invalid link" `Quick expect_invalid_link;
          Alcotest.test_case "duplicate agent" `Quick expect_duplicate_agent;
          Alcotest.test_case "invalid tmux session" `Quick
            expect_invalid_tmux_session;
          Alcotest.test_case "missing file result" `Quick
            expect_missing_file_is_result;
          Alcotest.test_case "unknown permission" `Quick
            expect_unknown_permission;
        ] );
      ("id", [ Alcotest.test_case "bad id" `Quick expect_bad_id ]);
      ( "state_store",
        [
          Alcotest.test_case "loads config" `Quick
            expect_state_store_loads_config;
          Alcotest.test_case "acl" `Quick expect_state_store_acl;
          Alcotest.test_case "status audit" `Quick
            expect_state_store_status_audit;
          Alcotest.test_case "attach pane" `Quick expect_state_store_attach_pane;
          Alcotest.test_case "missing agent" `Quick
            expect_state_store_missing_agent;
          Alcotest.test_case "rejects invalid config" `Quick
            expect_state_store_rejects_invalid_config;
          Alcotest.test_case "rejects unknown actor" `Quick
            expect_state_store_rejects_unknown_actor;
        ] );
      ( "roster_index",
        [
          Alcotest.test_case "parse agents" `Quick expect_roster_index_parse;
          Alcotest.test_case "unknown roster agent" `Quick
            expect_unknown_roster_agent;
        ] );
      ( "tmux",
        [
          Alcotest.test_case "argv" `Quick expect_tmux_argv;
          Alcotest.test_case "quotes command" `Quick expect_tmux_quotes_command;
        ] );
    ]
