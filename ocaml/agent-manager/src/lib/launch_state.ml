let ( let* ) = Result.bind

let preflight_agent store (agent : Launch_plan.agent) =
  let* workspace = State_store.find_workspace store agent.workspace in
  let* current = State_store.find_agent workspace agent.name in
  match current.pane with
  | None -> Ok ()
  | Some pane ->
      Error
        (Printf.sprintf "agent %s in workspace %s already has pane %s"
           (Id.Agent.to_string agent.name)
           (Id.Workspace.to_string agent.workspace)
           (Id.Pane.to_string pane))

let preflight store (plan : Launch_plan.t) =
  let rec loop = function
    | [] -> Ok ()
    | workspace :: rest ->
        let rec agents = function
          | [] -> loop rest
          | agent :: rest -> (
              match preflight_agent store agent with
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
