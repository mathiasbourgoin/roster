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

let selected_agent name =
  let workspace = Ta_core.Id.Workspace.unsafe_of_string "fixture" in
  let agent = Ta_core.Id.Agent.unsafe_of_string name in
  match Ta_core.Launch_plan.find_agent (parsed_plan ()) ~workspace ~agent with
  | Ok selected -> selected
  | Error message -> Alcotest.fail message

let expect_command_lines () =
  match Ta_core.Launch_runtime.dry_run_lines (parsed_plan ()) with
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok lines ->
      Alcotest.(check (list string))
        "dry run"
        [
          "tmux new-session -d -P -F '#{pane_id}' -s ta-fixture -c \
           /tmp/project 'env' 'ROLE=lead' 'codex'";
          "tmux split-window -d -P -F '#{pane_id}' -t ta-fixture -c \
           /tmp/project/qa 'codex'";
          "tmux select-layout -t ta-fixture tiled";
          "# startup prompt for fixture/lead will be sent to the captured \
           native pane id";
        ]
        lines

let expect_command_lines_are_executable_commands () =
  match Ta_core.Launch_runtime.command_lines (parsed_plan ()) with
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok lines ->
      Alcotest.(check bool)
        "no comments" true
        (List.for_all
           (fun line ->
             not (String.length line > 0 && Char.equal (String.get line 0) '#'))
           lines)

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

let tmux_error command output =
  {
    Ta_core.Tmux.argv = "tmux" :: Ta_core.Tmux.argv command;
    status = Unix.WEXITED 1;
    output;
  }

let identity_for_target target =
  match Ta_core.Tmux.target_to_string target with
  | "%10" -> Ok "$1\t@1\n"
  | "%11" -> Ok "$1\t@2\n"
  | _ -> Ok "$1\t@9\n"

let expect_run_returns_attachments () =
  let commands = ref [] in
  let runner command =
    commands := command :: !commands;
    match command with
    | Ta_core.Tmux.Has_session _ -> Error (tmux_error command "missing")
    | Ta_core.Tmux.New_detached_session_with_pane_id _ -> Ok "%10\n"
    | Ta_core.Tmux.Split_window_with_pane_id _ -> Ok "%11\n"
    | Ta_core.Tmux.Display_pane_identity target -> identity_for_target target
    | _ -> Ok ""
  in
  match Ta_core.Launch_runtime.run_with runner (parsed_plan ()) with
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok attachments ->
      Alcotest.(check (list string))
        "panes" [ "%10"; "%11" ]
        (List.map
           (fun (attachment : Ta_core.Launch_runtime.attachment) ->
             Ta_core.Id.Pane.to_string attachment.pane)
           attachments);
      Alcotest.(check (list string))
        "agents" [ "lead"; "qa" ]
        (List.map
           (fun (attachment : Ta_core.Launch_runtime.attachment) ->
             Ta_core.Id.Agent.to_string attachment.agent)
           attachments);
      Alcotest.(check (list string))
        "identities" [ "$1/@1"; "$1/@2" ]
        (List.map
           (fun (attachment : Ta_core.Launch_runtime.attachment) ->
             attachment.identity.session_id ^ "/"
             ^ attachment.identity.window_id)
           attachments);
      let prompt_targets =
        !commands
        |> List.filter_map (function
          | Ta_core.Tmux.Send_keys_literal { target; _ } ->
              Some (Ta_core.Tmux.target_to_string target)
          | _ -> None)
        |> List.rev
      in
      Alcotest.(check (list string))
        "prompt target uses captured pane" [ "%10" ] prompt_targets

let expect_query_failure_cleans_created_session () =
  let commands = ref [] in
  let runner command =
    commands := command :: !commands;
    match command with
    | Ta_core.Tmux.Has_session _ -> Error (tmux_error command "missing")
    | Ta_core.Tmux.New_detached_session_with_pane_id _ -> Ok "not a pane id\n"
    | _ -> Ok ""
  in
  match Ta_core.Launch_runtime.run_with runner (parsed_plan ()) with
  | Error (Ta_core.Launch_runtime.Invalid_pane_id _) ->
      let saw_cleanup =
        List.exists
          (function
            | Ta_core.Tmux.Kill_session session ->
                String.equal "ta-fixture"
                  (Ta_core.Tmux.session_to_string session)
            | _ -> false)
          !commands
      in
      Alcotest.(check bool) "cleanup" true saw_cleanup
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok _ -> Alcotest.fail "invalid pane id should fail"

let expect_split_failure_cleans_created_session () =
  let commands = ref [] in
  let runner command =
    commands := command :: !commands;
    match command with
    | Ta_core.Tmux.Has_session _ -> Error (tmux_error command "missing")
    | Ta_core.Tmux.New_detached_session_with_pane_id _ -> Ok "%10\n"
    | Ta_core.Tmux.Display_pane_identity target -> identity_for_target target
    | Ta_core.Tmux.Split_window_with_pane_id _ -> Ok "not a pane id\n"
    | _ -> Ok ""
  in
  match Ta_core.Launch_runtime.run_with runner (parsed_plan ()) with
  | Error (Ta_core.Launch_runtime.Invalid_pane_id _) ->
      let saw_cleanup =
        List.exists
          (function
            | Ta_core.Tmux.Kill_session session ->
                String.equal "ta-fixture"
                  (Ta_core.Tmux.session_to_string session)
            | _ -> false)
          !commands
      in
      Alcotest.(check bool) "cleanup" true saw_cleanup
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok _ -> Alcotest.fail "invalid split pane id should fail"

let expect_prompt_failure_cleans_created_session () =
  let commands = ref [] in
  let runner command =
    commands := command :: !commands;
    match command with
    | Ta_core.Tmux.Has_session _ -> Error (tmux_error command "missing")
    | Ta_core.Tmux.New_detached_session_with_pane_id _ -> Ok "%10\n"
    | Ta_core.Tmux.Split_window_with_pane_id _ -> Ok "%11\n"
    | Ta_core.Tmux.Display_pane_identity target -> identity_for_target target
    | Ta_core.Tmux.Send_keys_literal _ -> Error (tmux_error command "prompt")
    | _ -> Ok ""
  in
  match Ta_core.Launch_runtime.run_with runner (parsed_plan ()) with
  | Error (Ta_core.Launch_runtime.Tmux _) ->
      let saw_cleanup =
        List.exists
          (function
            | Ta_core.Tmux.Kill_session session ->
                String.equal "ta-fixture"
                  (Ta_core.Tmux.session_to_string session)
            | _ -> false)
          !commands
      in
      Alcotest.(check bool) "cleanup" true saw_cleanup
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok _ -> Alcotest.fail "prompt send should fail"

let expect_run_agent_creates_missing_session () =
  let commands = ref [] in
  let runner command =
    commands := command :: !commands;
    match command with
    | Ta_core.Tmux.Has_session _ -> Error (tmux_error command "missing")
    | Ta_core.Tmux.New_detached_session_with_pane_id _ -> Ok "%10\n"
    | Ta_core.Tmux.Display_pane_identity target -> identity_for_target target
    | _ -> Ok ""
  in
  let selected = selected_agent "lead" in
  match
    Ta_core.Launch_runtime.run_agent_with runner selected.workspace
      selected.agent
  with
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok started ->
      Alcotest.(check string)
        "pane" "%10"
        (Ta_core.Id.Pane.to_string started.attachment.pane);
      Alcotest.(check string)
        "cleanup session" "tmux kill-session -t ta-fixture"
        (Ta_core.Tmux.command_line started.cleanup_command);
      let prompt_targets =
        !commands
        |> List.filter_map (function
          | Ta_core.Tmux.Send_keys_literal { target; _ } ->
              Some (Ta_core.Tmux.target_to_string target)
          | _ -> None)
        |> List.rev
      in
      Alcotest.(check (list string))
        "prompt target uses captured pane" [ "%10" ] prompt_targets

let expect_run_agent_splits_existing_session () =
  let commands = ref [] in
  let runner command =
    commands := command :: !commands;
    match command with
    | Ta_core.Tmux.Has_session _ -> Ok ""
    | Ta_core.Tmux.Split_window_with_pane_id _ -> Ok "%11\n"
    | Ta_core.Tmux.Display_pane_identity target -> identity_for_target target
    | _ -> Ok ""
  in
  let selected = selected_agent "qa" in
  match
    Ta_core.Launch_runtime.run_agent_with runner selected.workspace
      selected.agent
  with
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok started ->
      Alcotest.(check string)
        "pane" "%11"
        (Ta_core.Id.Pane.to_string started.attachment.pane);
      Alcotest.(check string)
        "cleanup pane" "tmux kill-pane -t %11"
        (Ta_core.Tmux.command_line started.cleanup_command);
      let saw_layout =
        List.exists
          (function Ta_core.Tmux.Select_layout _ -> true | _ -> false)
          !commands
      in
      Alcotest.(check bool) "layout refreshed" true saw_layout

let expect_run_agent_prompt_failure_cleans_split_pane () =
  let commands = ref [] in
  let runner command =
    commands := command :: !commands;
    match command with
    | Ta_core.Tmux.Has_session _ -> Ok ""
    | Ta_core.Tmux.Split_window_with_pane_id _ -> Ok "%10\n"
    | Ta_core.Tmux.Display_pane_identity target -> identity_for_target target
    | Ta_core.Tmux.Send_keys_literal _ -> Error (tmux_error command "prompt")
    | _ -> Ok ""
  in
  let selected = selected_agent "lead" in
  match
    Ta_core.Launch_runtime.run_agent_with runner selected.workspace
      selected.agent
  with
  | Error (Ta_core.Launch_runtime.Tmux _) ->
      let saw_cleanup =
        List.exists
          (function
            | Ta_core.Tmux.Kill_pane target ->
                String.equal "%10" (Ta_core.Tmux.target_to_string target)
            | _ -> false)
          !commands
      in
      Alcotest.(check bool) "pane cleanup" true saw_cleanup
  | Error error -> Alcotest.fail (Ta_core.Launch_runtime.error_to_string error)
  | Ok _ -> Alcotest.fail "prompt send should fail"

let () =
  Alcotest.run "launch-runtime"
    [
      ( "launch_runtime",
        [
          Alcotest.test_case "command lines" `Quick expect_command_lines;
          Alcotest.test_case "executable command lines" `Quick
            expect_command_lines_are_executable_commands;
          Alcotest.test_case "duplicate session" `Quick
            expect_duplicate_session_error;
          Alcotest.test_case "run returns attachments" `Quick
            expect_run_returns_attachments;
          Alcotest.test_case "query failure cleans created session" `Quick
            expect_query_failure_cleans_created_session;
          Alcotest.test_case "split failure cleans created session" `Quick
            expect_split_failure_cleans_created_session;
          Alcotest.test_case "prompt failure cleans created session" `Quick
            expect_prompt_failure_cleans_created_session;
          Alcotest.test_case "run agent creates missing session" `Quick
            expect_run_agent_creates_missing_session;
          Alcotest.test_case "run agent splits existing session" `Quick
            expect_run_agent_splits_existing_session;
          Alcotest.test_case "run agent prompt failure cleans split pane" `Quick
            expect_run_agent_prompt_failure_cleans_split_pane;
        ] );
    ]
