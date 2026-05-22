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
        {
          "name": "lead",
          "roster_agent": "tech-lead",
          "command": ["codex"],
          "env": [{"name": "ROLE", "value": "lead"}],
          "startup_prompt": "Start lead"
        },
        {
          "name": "qa",
          "roster_agent": "qa",
          "command": ["codex"],
          "cwd": "qa"
        }
      ]
    }
  ]
}
|}

let parsed_plan () =
  match Ta_core.Workspace_config.parse_string config with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config -> (
      match Ta_core.Launch_plan.of_config ~config_dir:"/tmp/project" config with
      | Ok plan -> plan
      | Error errors ->
          Alcotest.fail
            (String.concat "\n"
               (List.map Ta_core.Workspace_config.error_to_string errors)))

let expect_command_lines () =
  match Ta_core.Launch_runtime.command_lines (parsed_plan ()) with
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok lines ->
      Alcotest.(check (list string))
        "commands"
        [
          "tmux new-session -d -s ta-fixture -c /tmp/project 'env' 'ROLE=lead' \
           'codex'";
          "tmux split-window -d -t ta-fixture:0 -c /tmp/project/qa 'codex'";
          "tmux select-layout -t ta-fixture:0 tiled";
          "tmux send-keys -l -t ta-fixture:0.0 'Start lead'";
          "tmux send-keys -t ta-fixture:0.0 '' Enter";
        ]
        lines

let duplicate_session_config =
  {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "one",
      "label": "One",
      "root": ".",
      "tmux_session": "ta-same",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [{"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]}]
    },
    {
      "id": "two",
      "label": "Two",
      "root": ".",
      "tmux_session": "ta-same",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [{"name": "qa", "roster_agent": "qa", "command": ["codex"]}]
    }
  ]
}
|}

let plan_of_text text =
  match Ta_core.Workspace_config.parse_string text with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config -> (
      match Ta_core.Launch_plan.of_config config with
      | Ok plan -> plan
      | Error errors ->
          Alcotest.fail
            (String.concat "\n"
               (List.map Ta_core.Workspace_config.error_to_string errors)))

let expect_duplicate_session_error () =
  match
    Ta_core.Launch_runtime.command_lines (plan_of_text duplicate_session_config)
  with
  | Error (Ta_core.Launch_runtime.Duplicate_session session) ->
      Alcotest.(check string)
        "session" "ta-same"
        (Ta_core.Tmux.session_to_string session)
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok _ -> Alcotest.fail "duplicate session should fail"

let () =
  Alcotest.run "launch-runtime"
    [
      ( "launch_runtime",
        [
          Alcotest.test_case "command lines" `Quick expect_command_lines;
          Alcotest.test_case "duplicate session" `Quick
            expect_duplicate_session_error;
        ] );
    ]
