type error =
  | Empty_workspace of Id.Workspace.t
  | Duplicate_session of Tmux.session
  | Session_exists of Tmux.session
  | Tmux of Tmux.error

let workspace_window_target workspace =
  Tmux.unsafe_target_of_string
    (Tmux.session_to_string workspace.Launch_plan.session ^ ":0")

let agent_target agent =
  Tmux.unsafe_target_of_string agent.Launch_plan.tmux_target

let command_with_env (agent : Launch_plan.agent) =
  match agent.env with
  | [] -> agent.command
  | env ->
      "env"
      :: (List.map (fun (name, value) -> name ^ "=" ^ value) env @ agent.command)

let prompt_command agent =
  match agent.Launch_plan.startup_prompt with
  | None -> []
  | Some text ->
      [
        Tmux.Send_keys_literal { target = agent_target agent; text };
        Tmux.Send_keys_to { target = agent_target agent; text = "" };
      ]

let workspace_commands workspace =
  match workspace.Launch_plan.agents with
  | [] -> Error (Empty_workspace workspace.id)
  | first :: rest ->
      let first_command =
        Tmux.New_detached_session
          {
            session = workspace.session;
            cwd = Some first.cwd;
            command = command_with_env first;
          }
      in
      let split_commands =
        rest
        |> List.map (fun (agent : Launch_plan.agent) ->
            Tmux.Split_window
              {
                target = workspace_window_target workspace;
                cwd = Some agent.cwd;
                command = command_with_env agent;
              })
      in
      let layout_commands =
        match rest with
        | [] -> []
        | _ ->
            [
              Tmux.Select_layout
                { target = workspace_window_target workspace; layout = "tiled" };
            ]
      in
      Ok
        ([ first_command ] @ split_commands @ layout_commands
        @ List.concat_map prompt_command workspace.agents)

let duplicate_session = function
  | [] -> None
  | sessions ->
      let sorted = List.sort Tmux.compare_session sessions in
      let rec loop previous = function
        | [] -> None
        | session :: rest -> (
            match previous with
            | Some prev when Tmux.equal_session prev session -> Some session
            | _ -> loop (Some session) rest)
      in
      loop None sorted

let sessions (plan : Launch_plan.t) =
  List.map (fun workspace -> workspace.Launch_plan.session) plan.workspaces

let validate_sessions plan =
  match duplicate_session (sessions plan) with
  | Some session -> Error (Duplicate_session session)
  | None -> Ok ()

let commands (plan : Launch_plan.t) =
  let rec loop acc = function
    | [] -> Ok (List.rev acc |> List.concat)
    | workspace :: rest -> (
        match workspace_commands workspace with
        | Error error -> Error error
        | Ok commands -> loop (commands :: acc) rest)
  in
  loop [] plan.workspaces

let command_lines (plan : Launch_plan.t) =
  match validate_sessions plan with
  | Error error -> Error error
  | Ok () -> (
      match commands plan with
      | Error error -> Error error
      | Ok commands -> Ok (List.map Tmux.command_line commands))

let run_command command =
  match Tmux.run command with
  | Ok _ -> Ok ()
  | Error error -> Error (Tmux error)

let ensure_session_absent session =
  match Tmux.run (Tmux.Has_session session) with
  | Ok _ -> Error (Session_exists session)
  | Error _ -> Ok ()

let cleanup sessions =
  List.iter
    (fun session -> ignore (Tmux.run (Tmux.Kill_session session)))
    sessions

let run (plan : Launch_plan.t) =
  match commands plan with
  | Error error -> Error error
  | Ok commands -> (
      let sessions = sessions plan in
      match validate_sessions plan with
      | Error error -> Error error
      | Ok () -> (
          let rec ensure = function
            | [] -> Ok ()
            | session :: rest -> (
                match ensure_session_absent session with
                | Ok () -> ensure rest
                | Error _ as error -> error)
          in
          let rec execute created = function
            | [] -> Ok ()
            | command :: rest -> (
                match run_command command with
                | Ok () ->
                    let created =
                      match command with
                      | Tmux.New_detached_session { session; _ } ->
                          session :: created
                      | _ -> created
                    in
                    execute created rest
                | Error _ as error ->
                    cleanup created;
                    error)
          in
          match ensure sessions with
          | Ok () -> execute [] commands
          | Error _ as error -> error))

let error_to_string = function
  | Empty_workspace workspace ->
      "workspace has no agents: " ^ Id.Workspace.to_string workspace
  | Duplicate_session session ->
      "duplicate tmux session in launch plan: " ^ Tmux.session_to_string session
  | Session_exists session ->
      "tmux session already exists: " ^ Tmux.session_to_string session
  | Tmux error -> Tmux.error_to_string error
