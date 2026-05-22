let ( let* ) = Result.bind

let validate_agent store (agent : Launch_plan.agent) =
  let* workspace = State_store.find_workspace store agent.workspace in
  let* _agent = State_store.find_agent workspace agent.name in
  Ok ()

let preflight store (plan : Launch_plan.t) =
  let rec loop = function
    | [] -> Ok ()
    | workspace :: rest ->
        let rec agents = function
          | [] -> loop rest
          | agent :: rest -> (
              match validate_agent store agent with
              | Ok () -> agents rest
              | Error _ as error -> error)
        in
        agents workspace.Launch_plan.agents
  in
  loop plan.workspaces

let apply_attachment store (attachment : Launch_runtime.attachment) =
  State_store.attach_pane store ~workspace:attachment.workspace
    ~agent:attachment.agent ~pane:attachment.pane ~actor:None

let apply_attachments store attachments =
  List.fold_left
    (fun acc attachment ->
      match acc with
      | Error _ as error -> error
      | Ok store -> apply_attachment store attachment)
    (Ok store) attachments
