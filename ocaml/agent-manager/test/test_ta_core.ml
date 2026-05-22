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
  (match Ta_core.Id.Agent.of_string "bad id" with
  | Ok _ -> Alcotest.fail "bad id should be rejected"
  | Error _ -> ());
  match Ta_core.Id.Pane.of_string "%77" with
  | Ok pane ->
      Alcotest.(check string)
        "tmux pane id" "%77"
        (Ta_core.Id.Pane.to_string pane)
  | Error message -> Alcotest.fail message

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

let expect_tmux_launch_argv () =
  let target = Ta_core.Tmux.unsafe_target_of_string "ta-test:0" in
  Alcotest.(check (list string))
    "split argv"
    [
      "split-window";
      "-d";
      "-t";
      "ta-test:0";
      "-c";
      "/tmp/project";
      "'env' 'ROLE=qa' 'codex'";
    ]
    (Ta_core.Tmux.argv
       (Ta_core.Tmux.Split_window
          {
            target;
            cwd = Some "/tmp/project";
            command = [ "env"; "ROLE=qa"; "codex" ];
          }));
  Alcotest.(check (list string))
    "layout argv"
    [ "select-layout"; "-t"; "ta-test:0"; "tiled" ]
    (Ta_core.Tmux.argv
       (Ta_core.Tmux.Select_layout { target; layout = "tiled" }))

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
          Alcotest.test_case "launch argv" `Quick expect_tmux_launch_argv;
        ] );
    ]
