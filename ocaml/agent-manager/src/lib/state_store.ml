include State_model

type snapshot_error = State_snapshot.error = { path : string; message : string }

let snapshot_error_to_string = State_snapshot.error_to_string
let to_yojson = State_snapshot.to_yojson
let of_yojson = State_snapshot.of_yojson

let agent_of_config (agent : Workspace_config.agent) =
  {
    name = agent.name;
    roster_agent = agent.roster_agent;
    status = Not_started;
    pane = None;
  }

let link_of_config (link : Workspace_config.link) =
  {
    from_agent = link.from_agent;
    to_agent = link.to_agent;
    permissions = link.permissions;
    reason = link.reason;
  }

let workspace_of_config (workspace : Workspace_config.workspace) =
  {
    id = workspace.id;
    label = workspace.label;
    root = workspace.root;
    active_view = workspace.default_view;
    agents = List.map agent_of_config workspace.agents;
    links = List.map link_of_config workspace.links;
  }

let append_event store ~workspace ~actor kind =
  let event = { seq = store.next_seq; workspace; actor; kind } in
  {
    store with
    audit_events = event :: store.audit_events;
    next_seq = store.next_seq + 1;
  }

let of_validated_config (config : Workspace_config.t) =
  let workspaces = List.map workspace_of_config config.workspaces in
  let store = { workspaces; audit_events = []; next_seq = 1 } in
  List.fold_left
    (fun acc (workspace : workspace) ->
      append_event acc ~workspace:workspace.id ~actor:None Workspace_loaded)
    store workspaces

let of_config (config : Workspace_config.t) =
  match Workspace_config.validate config with
  | [] -> Ok (of_validated_config config)
  | errors -> Error errors

let workspaces store = store.workspaces
let audit_events store = List.rev store.audit_events

let find_workspace store workspace_id =
  match
    List.find_opt
      (fun (workspace : workspace) ->
        Id.Workspace.equal workspace.id workspace_id)
      store.workspaces
  with
  | Some workspace -> Ok workspace
  | None -> Error ("unknown workspace: " ^ Id.Workspace.to_string workspace_id)

let find_agent (workspace : workspace) agent_id =
  match
    List.find_opt
      (fun (agent : agent) -> Id.Agent.equal agent.name agent_id)
      workspace.agents
  with
  | Some agent -> Ok agent
  | None -> Error ("unknown agent: " ^ Id.Agent.to_string agent_id)

let update_agent agents agent_id f =
  let rec loop changed acc = function
    | [] ->
        if changed then Ok (List.rev acc)
        else Error ("unknown agent: " ^ Id.Agent.to_string agent_id)
    | agent :: rest ->
        if Id.Agent.equal agent.name agent_id then
          loop true (f agent :: acc) rest
        else loop changed (agent :: acc) rest
  in
  loop false [] agents

let update_workspace store workspace_id f =
  let rec loop changed acc = function
    | [] ->
        if changed then Ok { store with workspaces = List.rev acc }
        else Error ("unknown workspace: " ^ Id.Workspace.to_string workspace_id)
    | workspace :: rest ->
        if Id.Workspace.equal workspace.id workspace_id then
          loop true (f workspace :: acc) rest
        else loop changed (workspace :: acc) rest
  in
  loop false [] store.workspaces

let can_access store ~workspace ~from_agent ~to_agent permission =
  match find_workspace store workspace with
  | Error _ -> false
  | Ok workspace ->
      workspace.links
      |> List.exists (fun link ->
          Id.Agent.equal link.from_agent from_agent
          && Id.Agent.equal link.to_agent to_agent
          && List.exists (Permission.equal permission) link.permissions)

let ( let* ) = Result.bind

let validate_actor workspace = function
  | None -> Ok ()
  | Some actor -> (
      match find_agent workspace actor with
      | Ok _ -> Ok ()
      | Error error -> Error error)

let set_agent_status store ~workspace ~agent ~status ~actor =
  let* current_workspace = find_workspace store workspace in
  let* () = validate_actor current_workspace actor in
  let* current_agent = find_agent current_workspace agent in
  let* updated =
    update_workspace store workspace (fun workspace ->
        let agents =
          match
            update_agent workspace.agents agent (fun agent ->
                { agent with status })
          with
          | Ok agents -> agents
          | Error _ -> workspace.agents
        in
        { workspace with agents })
  in
  Ok
    (append_event updated ~workspace ~actor
       (Agent_status_changed
          { agent; before = current_agent.status; after = status }))

let attach_pane store ~workspace ~agent ~pane ~actor =
  let* current_workspace = find_workspace store workspace in
  let* () = validate_actor current_workspace actor in
  let* _current_agent = find_agent current_workspace agent in
  let* updated =
    update_workspace store workspace (fun workspace ->
        let agents =
          match
            update_agent workspace.agents agent (fun agent ->
                { agent with pane = Some pane })
          with
          | Ok agents -> agents
          | Error _ -> workspace.agents
        in
        { workspace with agents })
  in
  Ok (append_event updated ~workspace ~actor (Pane_attached { agent; pane }))
