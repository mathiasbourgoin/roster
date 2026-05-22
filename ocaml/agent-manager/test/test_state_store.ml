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

let replace_assoc name value = function
  | `Assoc fields -> `Assoc ((name, value) :: fields)
  | json -> json

let last_event events =
  match List.rev events with
  | event :: _ -> event
  | [] -> Alcotest.fail "expected at least one event"

let expect_loads_config () =
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

let expect_acl () =
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

let expect_status_audit () =
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

let expect_attach_pane () =
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

let expect_missing_agent () =
  let store = valid_store () in
  let workspace = Ta_core.Id.Workspace.unsafe_of_string "agent-roster" in
  let missing = Ta_core.Id.Agent.unsafe_of_string "missing" in
  match
    Ta_core.State_store.set_agent_status store ~workspace ~agent:missing
      ~status:Ta_core.State_store.Running ~actor:None
  with
  | Ok _ -> Alcotest.fail "missing agent should fail"
  | Error _ -> ()

let expect_rejects_invalid_config () =
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

let expect_rejects_unknown_actor () =
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

let store_with_runtime_changes () =
  let store = valid_store () in
  let workspace = Ta_core.Id.Workspace.unsafe_of_string "agent-roster" in
  let lead = Ta_core.Id.Agent.unsafe_of_string "tech-lead" in
  let pane = Ta_core.Id.Pane.unsafe_of_string "lead.0" in
  match
    Ta_core.State_store.set_agent_status store ~workspace ~agent:lead
      ~status:Ta_core.State_store.Running ~actor:(Some lead)
  with
  | Error message -> Alcotest.fail message
  | Ok store -> (
      match
        Ta_core.State_store.attach_pane store ~workspace ~agent:lead ~pane
          ~actor:(Some lead)
      with
      | Error message -> Alcotest.fail message
      | Ok store -> (store, workspace, lead, pane))

let expect_snapshot_roundtrip () =
  let store, workspace_id, lead, pane = store_with_runtime_changes () in
  let qa = Ta_core.Id.Agent.unsafe_of_string "qa" in
  let json = Ta_core.State_store.to_yojson store in
  match Ta_core.State_store.of_yojson json with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.State_store.snapshot_error_to_string errors))
  | Ok restored -> (
      Alcotest.(check int)
        "event count" 3
        (List.length (Ta_core.State_store.audit_events restored));
      match Ta_core.State_store.find_workspace restored workspace_id with
      | Error message -> Alcotest.fail message
      | Ok workspace -> (
          match Ta_core.State_store.find_agent workspace lead with
          | Error message -> Alcotest.fail message
          | Ok agent -> (
              Alcotest.(check string)
                "status" "running"
                (Ta_core.State_store.status_to_string agent.status);
              Alcotest.(check bool)
                "pane" true
                (Option.equal Ta_core.Id.Pane.equal agent.pane (Some pane));
              Alcotest.(check bool)
                "restored acl" true
                (Ta_core.State_store.can_access restored ~workspace:workspace_id
                   ~from_agent:lead ~to_agent:qa Ta_core.Permission.Read);
              match
                Ta_core.State_store.set_agent_status restored
                  ~workspace:workspace_id ~agent:lead
                  ~status:Ta_core.State_store.Idle ~actor:(Some lead)
              with
              | Error message -> Alcotest.fail message
              | Ok advanced ->
                  Ta_core.State_store.audit_events advanced
                  |> last_event
                  |> check_audit_seq "continued seq" 4)))

let expect_snapshot_rejects_version () =
  let store, _, _, _ = store_with_runtime_changes () in
  let json =
    Ta_core.State_store.to_yojson store
    |> replace_assoc "version" (`String "9.9.9")
  in
  match Ta_core.State_store.of_yojson json with
  | Ok _ -> Alcotest.fail "bad snapshot version should fail"
  | Error errors ->
      Alcotest.(check int) "one snapshot error" 1 (List.length errors)

let expect_snapshot_rejects_next_seq () =
  let store, _, _, _ = store_with_runtime_changes () in
  let json =
    Ta_core.State_store.to_yojson store |> replace_assoc "next_seq" (`Int 3)
  in
  match Ta_core.State_store.of_yojson json with
  | Ok _ -> Alcotest.fail "stale next_seq should fail"
  | Error errors ->
      Alcotest.(check int) "one snapshot error" 1 (List.length errors)

let expect_snapshot_rejects_future_next_seq () =
  let store, _, _, _ = store_with_runtime_changes () in
  let json =
    Ta_core.State_store.to_yojson store |> replace_assoc "next_seq" (`Int 99)
  in
  match Ta_core.State_store.of_yojson json with
  | Ok _ -> Alcotest.fail "future next_seq should fail"
  | Error errors ->
      Alcotest.(check int) "one snapshot error" 1 (List.length errors)

let expect_snapshot_rejects_audit_gap () =
  let store, _, _, _ = store_with_runtime_changes () in
  let rewrite_events = function
    | `List (first :: second :: rest) ->
        `List (first :: replace_assoc "seq" (`Int 9) second :: rest)
    | events -> events
  in
  let json =
    match Ta_core.State_store.to_yojson store with
    | `Assoc fields -> (
        match List.assoc_opt "audit_events" fields with
        | None -> Alcotest.fail "missing audit events"
        | Some events ->
            `Assoc (("audit_events", rewrite_events events) :: fields))
    | other -> other
  in
  match Ta_core.State_store.of_yojson json with
  | Ok _ -> Alcotest.fail "audit sequence gap should fail"
  | Error errors ->
      Alcotest.(check int) "one snapshot error" 1 (List.length errors)

let expect_snapshot_rejects_broken_audit_reference () =
  let json =
    Yojson.Safe.from_string
      {|
{
  "version": "0.1.0",
  "next_seq": 2,
  "workspaces": [
    {
      "id": "w",
      "label": "W",
      "root": ".",
      "active_view": "agents",
      "agents": [
        {
          "name": "lead",
          "roster_agent": "tech-lead",
          "status": {"kind": "not-started"},
          "pane": null
        }
      ],
      "links": []
    }
  ],
  "audit_events": [
    {
      "seq": 1,
      "workspace": "w",
      "actor": null,
      "kind": {
        "kind": "agent-status-changed",
        "agent": "qa",
        "before": {"kind": "not-started"},
        "after": {"kind": "running"}
      }
    }
  ]
}
|}
  in
  match Ta_core.State_store.of_yojson json with
  | Ok _ -> Alcotest.fail "broken audit agent should fail"
  | Error errors ->
      Alcotest.(check int) "one snapshot error" 1 (List.length errors)

let expect_snapshot_rejects_broken_graph () =
  let json =
    Yojson.Safe.from_string
      {|
{
  "version": "0.1.0",
  "next_seq": 2,
  "workspaces": [
    {
      "id": "w",
      "label": "W",
      "root": ".",
      "active_view": "agents",
      "agents": [
        {
          "name": "lead",
          "roster_agent": "tech-lead",
          "status": {"kind": "not-started"},
          "pane": null
        }
      ],
      "links": [
        {
          "from": "lead",
          "to": "qa",
          "permissions": ["read"],
          "reason": "missing target must be rejected"
        }
      ]
    }
  ],
  "audit_events": [
    {
      "seq": 1,
      "workspace": "w",
      "actor": null,
      "kind": {"kind": "workspace-loaded"}
    }
  ]
}
|}
  in
  match Ta_core.State_store.of_yojson json with
  | Ok _ -> Alcotest.fail "broken link target should fail"
  | Error errors ->
      Alcotest.(check int) "one snapshot error" 1 (List.length errors)

let () =
  Alcotest.run "state-store"
    [
      ( "state_store",
        [
          Alcotest.test_case "loads config" `Quick expect_loads_config;
          Alcotest.test_case "acl" `Quick expect_acl;
          Alcotest.test_case "status audit" `Quick expect_status_audit;
          Alcotest.test_case "attach pane" `Quick expect_attach_pane;
          Alcotest.test_case "missing agent" `Quick expect_missing_agent;
          Alcotest.test_case "rejects invalid config" `Quick
            expect_rejects_invalid_config;
          Alcotest.test_case "rejects unknown actor" `Quick
            expect_rejects_unknown_actor;
          Alcotest.test_case "snapshot roundtrip" `Quick
            expect_snapshot_roundtrip;
          Alcotest.test_case "snapshot rejects version" `Quick
            expect_snapshot_rejects_version;
          Alcotest.test_case "snapshot rejects stale next seq" `Quick
            expect_snapshot_rejects_next_seq;
          Alcotest.test_case "snapshot rejects future next seq" `Quick
            expect_snapshot_rejects_future_next_seq;
          Alcotest.test_case "snapshot rejects audit gap" `Quick
            expect_snapshot_rejects_audit_gap;
          Alcotest.test_case "snapshot rejects broken audit reference" `Quick
            expect_snapshot_rejects_broken_audit_reference;
          Alcotest.test_case "snapshot rejects broken graph" `Quick
            expect_snapshot_rejects_broken_graph;
        ] );
    ]
