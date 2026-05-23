let ( let* ) = Result.bind

let env_equal left right =
  List.equal
    (fun (left_name, left_value) (right_name, right_value) ->
      String.equal left_name right_name && String.equal left_value right_value)
    left right

let workspace_session_matches current planned =
  match current.State_store.tmux_session with
  | None -> false
  | Some session -> Tmux.equal_session session planned.Launch_plan.session

let workspace_matches_state current (planned : Launch_plan.workspace) =
  String.equal current.State_store.root planned.root
  && workspace_session_matches current planned

let preflight_workspace current (planned : Launch_plan.workspace) =
  if workspace_matches_state current planned then Ok ()
  else
    Error
      (Printf.sprintf
         "workspace %s launch identity changed; refresh state before starting"
         (Id.Workspace.to_string planned.id))

let launch_matches_state current (agent : Launch_plan.agent) =
  List.equal String.equal current.State_store.command agent.command
  && Option.equal String.equal current.cwd agent.configured_cwd
  && env_equal current.env agent.env
  && Option.equal String.equal current.startup_prompt agent.startup_prompt

let preflight_agent_in_workspace workspace (agent : Launch_plan.agent) =
  let* current = State_store.find_agent workspace agent.name in
  if not (launch_matches_state current agent) then
    Error
      (Printf.sprintf
         "agent %s in workspace %s launch profile changed; refresh state \
          before starting"
         (Id.Agent.to_string agent.name)
         (Id.Workspace.to_string agent.workspace))
  else
    match current.pane with
  | None -> Ok ()
  | Some pane ->
      Error
        (Printf.sprintf "agent %s in workspace %s already has pane %s"
           (Id.Agent.to_string agent.name)
           (Id.Workspace.to_string agent.workspace)
           (Id.Pane.to_string pane))

let preflight_agent store (selected : Launch_plan.selected_agent) =
  let* workspace = State_store.find_workspace store selected.workspace.id in
  let* () = preflight_workspace workspace selected.workspace in
  preflight_agent_in_workspace workspace selected.agent

let preflight store (plan : Launch_plan.t) =
  let rec loop = function
    | [] -> Ok ()
    | workspace :: rest ->
        let* workspace_state =
          State_store.find_workspace store workspace.Launch_plan.id
        in
        let* () = preflight_workspace workspace_state workspace in
        let rec agents = function
          | [] -> loop rest
          | agent :: rest -> (
              match preflight_agent_in_workspace workspace_state agent with
              | Ok () -> agents rest
              | Error _ as error -> error)
        in
        agents workspace.Launch_plan.agents
  in
  loop plan.workspaces

let apply_attachment ?actor store (attachment : Launch_runtime.attachment) =
  State_store.attach_pane ~identity:attachment.identity store
    ~workspace:attachment.workspace ~agent:attachment.agent
    ~pane:attachment.pane ~actor

let apply_attachments ?actor store attachments =
  List.fold_left
    (fun acc attachment ->
      match acc with
      | Error _ as error -> error
      | Ok store -> apply_attachment ?actor store attachment)
    (Ok store) attachments
