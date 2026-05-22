type error =
  | Empty_workspace of Id.Workspace.t
  | Duplicate_session of Tmux.session
  | Session_exists of Tmux.session
  | Invalid_pane_id of {
      target : Tmux.target;
      output : string;
      message : string;
    }
  | Tmux of Tmux.error

type attachment = {
  workspace : Id.Workspace.t;
  agent : Id.Agent.t;
  planned_pane : Id.Pane.t;
  pane : Id.Pane.t;
  identity : Tmux.pane_identity;
  target : Tmux.target;
}

type started_agent = {
  attachment : attachment;
  cleanup_command : Tmux.command;
}

type runner = Tmux.command -> (string, Tmux.error) result

let ( let* ) = Result.bind

let workspace_target workspace =
  Tmux.unsafe_target_of_string
    (Tmux.session_to_string workspace.Launch_plan.session)

let pane_target pane = Tmux.unsafe_target_of_string (Id.Pane.to_string pane)

let command_with_env (agent : Launch_plan.agent) =
  match agent.env with
  | [] -> agent.command
  | env ->
      "env"
      :: (List.map (fun (name, value) -> name ^ "=" ^ value) env @ agent.command)

let workspace_commands workspace =
  match workspace.Launch_plan.agents with
  | [] -> Error (Empty_workspace workspace.id)
  | first :: rest ->
      let first_command =
        Tmux.New_detached_session_with_pane_id
          {
            session = workspace.session;
            cwd = Some first.cwd;
            command = command_with_env first;
          }
      in
      let split_commands =
        rest
        |> List.map (fun (agent : Launch_plan.agent) ->
            Tmux.Split_window_with_pane_id
              {
                target = workspace_target workspace;
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
                { target = workspace_target workspace; layout = "tiled" };
            ]
      in
      Ok ([ first_command ] @ split_commands @ layout_commands)

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

let prompt_preview (agent : Launch_plan.agent) =
  match agent.startup_prompt with
  | None -> []
  | Some _ ->
      [
        Printf.sprintf
          "# startup prompt for %s/%s will be sent to the captured native pane \
           id"
          (Id.Workspace.to_string agent.workspace)
          (Id.Agent.to_string agent.name);
      ]

let workspace_dry_run_lines workspace =
  let* commands = workspace_commands workspace in
  Ok
    (List.map Tmux.command_line commands
    @ List.concat_map prompt_preview workspace.Launch_plan.agents)

let dry_run_lines plan =
  match validate_sessions plan with
  | Error error -> Error error
  | Ok () ->
      let rec loop acc = function
        | [] -> Ok (List.rev acc |> List.concat)
        | workspace :: rest ->
            let* lines = workspace_dry_run_lines workspace in
            loop (lines :: acc) rest
      in
      loop [] plan.workspaces

let run_command runner command =
  match runner command with Ok _ -> Ok () | Error error -> Error (Tmux error)

let ensure_session_absent runner session =
  match runner (Tmux.Has_session session) with
  | Ok _ -> Error (Session_exists session)
  | Error _ -> Ok ()

let cleanup runner sessions =
  List.iter
    (fun session -> ignore (runner (Tmux.Kill_session session)))
    sessions

let run_cleanup_command runner command = ignore (runner command)

let parse_pane_id ~target output =
  let output = String.trim output in
  match Id.Pane.of_string output with
  | Ok pane -> Ok pane
  | Error message -> Error (Invalid_pane_id { target; output; message })

let attachment target (agent : Launch_plan.agent) pane identity =
  {
    workspace = agent.workspace;
    agent = agent.name;
    planned_pane = agent.planned_pane;
    pane;
    identity;
    target;
  }

let run_pane_command runner ~target command =
  match runner command with
  | Error error -> Error (Tmux error)
  | Ok output -> parse_pane_id ~target output

let run_pane_identity runner ~target =
  match runner (Tmux.Display_pane_identity target) with
  | Error error -> Error (Tmux error)
  | Ok output -> (
      match Tmux.parse_pane_identity output with
      | Ok identity -> Ok identity
      | Error message ->
          Error
            (Invalid_pane_id { target; output = String.trim output; message }))

let prompt_commands target = function
  | None -> []
  | Some text ->
      [
        Tmux.Send_keys_literal { target; text };
        Tmux.Send_keys_to { target; text = "" };
      ]

let run_prompt runner (agent : Launch_plan.agent) attachment =
  let rec loop = function
    | [] -> Ok ()
    | command :: rest -> (
        match run_command runner command with
        | Ok () -> loop rest
        | Error _ as error -> error)
  in
  loop (prompt_commands attachment.target agent.startup_prompt)

let run_prompts runner agents attachments =
  let rec loop = function
    | [], [] -> Ok ()
    | agent :: agents, attachment :: attachments -> (
        match run_prompt runner agent attachment with
        | Ok () -> loop (agents, attachments)
        | Error _ as error -> error)
    | [], _ :: _ | _ :: _, [] -> invalid_arg "launch attachment mismatch"
  in
  loop (agents, attachments)

let session_exists runner session =
  match runner (Tmux.Has_session session) with Ok _ -> true | Error _ -> false

let pane_cleanup_command pane = Tmux.Kill_pane (pane_target pane)

let run_agent_in_existing_session runner workspace (agent : Launch_plan.agent) =
  let target = workspace_target workspace in
  let command =
    Tmux.Split_window_with_pane_id
      { target; cwd = Some agent.cwd; command = command_with_env agent }
  in
  let* pane = run_pane_command runner ~target command in
  let cleanup_command = pane_cleanup_command pane in
  let pane_target = pane_target pane in
  let result =
    let* identity = run_pane_identity runner ~target:pane_target in
    let attachment = attachment pane_target agent pane identity in
    let* () =
      run_command runner (Tmux.Select_layout { target; layout = "tiled" })
    in
    let* () = run_prompt runner agent attachment in
    Ok { attachment; cleanup_command }
  in
  match result with
  | Ok _ as ok -> ok
  | Error _ as error ->
      run_cleanup_command runner cleanup_command;
      error

let run_agent_in_new_session runner workspace (agent : Launch_plan.agent) =
  let target = workspace_target workspace in
  let command =
    Tmux.New_detached_session_with_pane_id
      {
        session = workspace.Launch_plan.session;
        cwd = Some agent.cwd;
        command = command_with_env agent;
      }
  in
  let* pane =
    match runner command with
    | Error error -> Error (Tmux error)
    | Ok output -> parse_pane_id ~target output
  in
  let cleanup_command = Tmux.Kill_session workspace.session in
  let pane_target = pane_target pane in
  let result =
    let* identity = run_pane_identity runner ~target:pane_target in
    let attachment = attachment pane_target agent pane identity in
    let* () = run_prompt runner agent attachment in
    Ok { attachment; cleanup_command }
  in
  match result with
  | Ok _ as ok -> ok
  | Error _ as error ->
      run_cleanup_command runner cleanup_command;
      error

let run_agent_with runner workspace agent =
  if session_exists runner workspace.Launch_plan.session then
    run_agent_in_existing_session runner workspace agent
  else run_agent_in_new_session runner workspace agent

let run_workspace runner created (workspace : Launch_plan.workspace) =
  match workspace.agents with
  | [] -> Error (Empty_workspace workspace.id)
  | first :: rest ->
      let target = workspace_target workspace in
      let first_command =
        Tmux.New_detached_session_with_pane_id
          {
            session = workspace.session;
            cwd = Some first.cwd;
            command = command_with_env first;
          }
      in
      let* first_pane =
        match runner first_command with
        | Error error -> Error (Tmux error)
        | Ok output ->
            created := workspace.session :: !created;
            parse_pane_id ~target output
      in
      let first_attachment =
        let target = pane_target first_pane in
        let* identity = run_pane_identity runner ~target in
        Ok (attachment target first first_pane identity)
      in
      let* first_attachment = first_attachment in
      let rec split acc = function
        | [] -> Ok (List.rev acc)
        | (agent : Launch_plan.agent) :: rest ->
            let command =
              Tmux.Split_window_with_pane_id
                {
                  target;
                  cwd = Some agent.cwd;
                  command = command_with_env agent;
                }
            in
            let* pane = run_pane_command runner ~target command in
            let pane_target = pane_target pane in
            let* identity = run_pane_identity runner ~target:pane_target in
            split (attachment pane_target agent pane identity :: acc) rest
      in
      let* attachments = split [ first_attachment ] rest in
      let* () =
        match rest with
        | [] -> Ok ()
        | _ ->
            run_command runner (Tmux.Select_layout { target; layout = "tiled" })
      in
      let* () = run_prompts runner workspace.agents attachments in
      Ok attachments

let run_with runner (plan : Launch_plan.t) =
  let sessions = sessions plan in
  match validate_sessions plan with
  | Error error -> Error error
  | Ok () -> (
      let rec ensure = function
        | [] -> Ok ()
        | session :: rest -> (
            match ensure_session_absent runner session with
            | Ok () -> ensure rest
            | Error _ as error -> error)
      in
      let created = ref [] in
      let rec execute acc = function
        | [] -> Ok (List.rev acc |> List.concat)
        | workspace :: rest -> (
            match run_workspace runner created workspace with
            | Ok attachments -> execute (attachments :: acc) rest
            | Error _ as error ->
                cleanup runner !created;
                error)
      in
      match ensure sessions with
      | Ok () -> execute [] plan.workspaces
      | Error _ as error -> error)

let run plan = run_with Tmux.run plan
let cleanup_started_agent_with runner started =
  run_cleanup_command runner started.cleanup_command

let cleanup_started_agent started = cleanup_started_agent_with Tmux.run started
let cleanup_plan plan = cleanup Tmux.run (sessions plan)

let error_to_string = function
  | Empty_workspace workspace ->
      "workspace has no agents: " ^ Id.Workspace.to_string workspace
  | Duplicate_session session ->
      "duplicate tmux session in launch plan: " ^ Tmux.session_to_string session
  | Session_exists session ->
      "tmux session already exists: " ^ Tmux.session_to_string session
  | Invalid_pane_id { target; output; message } ->
      Printf.sprintf "tmux target %s returned invalid pane id %S: %s"
        (Tmux.target_to_string target)
        output message
  | Tmux error -> Tmux.error_to_string error
