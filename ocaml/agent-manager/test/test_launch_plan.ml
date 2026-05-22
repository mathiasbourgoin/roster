let fixture name = Filename.concat "fixtures" name

let valid_config () =
  match Ta_core.Workspace_config.load (fixture "ta-valid.json") with
  | Ok config -> config
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let parse_config text =
  match Ta_core.Workspace_config.parse_string text with
  | Ok config -> config
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let expect_plan_metadata () =
  match Ta_core.Launch_plan.of_config (valid_config ()) with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok plan -> (
      Alcotest.(check int)
        "agent count" 2
        (Ta_core.Launch_plan.agent_count plan);
      match plan.workspaces with
      | [ workspace ] -> (
          Alcotest.(check string)
            "workspace" "fixture"
            (Ta_core.Id.Workspace.to_string workspace.id);
          match workspace.agents with
          | [ lead; qa ] ->
              Alcotest.(check string)
                "lead pane" "fixture%lead"
                (Ta_core.Id.Pane.to_string lead.planned_pane);
              Alcotest.(check string)
                "lead target" "ta-fixture:0.0" lead.tmux_target;
              Alcotest.(check string) "lead cwd" "." lead.cwd;
              Alcotest.(check string)
                "qa pane" "fixture%qa"
                (Ta_core.Id.Pane.to_string qa.planned_pane);
              Alcotest.(check string)
                "qa target" "ta-fixture:0.1" qa.tmux_target
          | _ -> Alcotest.fail "expected two agents")
      | _ -> Alcotest.fail "expected one workspace")

let expect_plan_description () =
  match Ta_core.Launch_plan.of_config (valid_config ()) with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok plan ->
      Alcotest.(check string)
        "description"
        (String.concat "\n"
           [
             "TA launch plan: 1 workspace(s), 2 agent(s)";
             "Workspace fixture session=ta-fixture root=.";
             "  - lead pane=fixture%lead target=ta-fixture:0.0 roster=tech-lead";
             "    cwd=.";
             "    command=codex";
             "    env=-";
             "    startup_prompt=-";
             "  - qa pane=fixture%qa target=ta-fixture:0.1 roster=qa";
             "    cwd=.";
             "    command=codex";
             "    env=-";
             "    startup_prompt=-";
           ])
        (Ta_core.Launch_plan.describe plan)

let complex_config =
  {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "a",
      "label": "A",
      "root": "repo",
      "tmux_session": "ta-a",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {
          "name": "b.c",
          "roster_agent": "tech-lead",
          "command": ["codex", "--profile", "lead"],
          "cwd": "services/api",
          "env": [{"name": "ROLE", "value": "lead"}],
          "startup_prompt": "Start lead"
        }
      ]
    },
    {
      "id": "a.b",
      "label": "B",
      "root": "/abs/work",
      "tmux_session": "ta-b",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {
          "name": "c",
          "roster_agent": "qa",
          "command": ["codex"],
          "cwd": "."
        }
      ]
    }
  ]
}
|}

let expect_base_dir_and_multi_workspace () =
  match
    Ta_core.Launch_plan.of_config ~config_dir:"/tmp/cfg"
      (parse_config complex_config)
  with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok plan -> (
      match plan.workspaces with
      | [ first; second ] -> (
          match (first.agents, second.agents) with
          | [ lead ], [ qa ] ->
              Alcotest.(check string) "first root" "/tmp/cfg/repo" first.root;
              Alcotest.(check string)
                "lead cwd" "/tmp/cfg/repo/services/api" lead.cwd;
              Alcotest.(check string)
                "lead pane" "a%b.c"
                (Ta_core.Id.Pane.to_string lead.planned_pane);
              Alcotest.(check string) "lead target" "ta-a:0.0" lead.tmux_target;
              Alcotest.(check string) "second root" "/abs/work" second.root;
              Alcotest.(check string) "qa cwd" "/abs/work" qa.cwd;
              Alcotest.(check string)
                "qa pane" "a.b%c"
                (Ta_core.Id.Pane.to_string qa.planned_pane);
              Alcotest.(check string) "qa target" "ta-b:0.0" qa.tmux_target;
              Alcotest.(check bool)
                "pane ids distinct" false
                (Ta_core.Id.Pane.equal lead.planned_pane qa.planned_pane);
              Alcotest.(check string) "env name" "ROLE" (fst (List.hd lead.env));
              Alcotest.(check (option string))
                "prompt" (Some "Start lead") lead.startup_prompt
          | _ -> Alcotest.fail "expected one agent per workspace")
      | _ -> Alcotest.fail "expected two workspaces")

let () =
  Alcotest.run "launch-plan"
    [
      ( "launch_plan",
        [
          Alcotest.test_case "metadata" `Quick expect_plan_metadata;
          Alcotest.test_case "description" `Quick expect_plan_description;
          Alcotest.test_case "base dir and multi-workspace" `Quick
            expect_base_dir_and_multi_workspace;
        ] );
    ]
