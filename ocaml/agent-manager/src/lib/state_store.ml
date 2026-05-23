include State_model

type snapshot_error = State_snapshot.error = { path : string; message : string }

let snapshot_error_to_string = State_snapshot.error_to_string
let to_yojson = State_snapshot.to_yojson
let of_yojson = State_snapshot.of_yojson

let agent_of_config (agent : Workspace_config.agent) =
  {
    name = agent.name;
    roster_agent = agent.roster_agent;
    command = agent.command;
    cwd = agent.cwd;
    env = agent.env;
    startup_prompt = agent.startup_prompt;
    status = Not_started;
    pane = None;
    pane_identity = None;
    capabilities = agent.capabilities;
  }

let link_of_config (link : Workspace_config.link) =
  {
    from_agent = link.from_agent;
    to_agent = link.to_agent;
    permissions = link.permissions;
    reason = link.reason;
  }

let resolve_path ~base path =
  Path_resolver.resolve ~base path

let workspace_of_config ~config_dir (workspace : Workspace_config.workspace) =
  {
    id = workspace.id;
    label = workspace.label;
    root = resolve_path ~base:config_dir workspace.root;
    harness_path = workspace.harness_path;
    tmux_session = Some workspace.tmux_session;
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

let of_validated_config ?(config_dir = ".") (config : Workspace_config.t) =
  let config_dir = Path_resolver.normalize config_dir in
  let workspaces =
    List.map (workspace_of_config ~config_dir) config.workspaces
  in
  let store = { workspaces; audit_events = []; next_seq = 1 } in
  List.fold_left
    (fun acc (workspace : workspace) ->
      append_event acc ~workspace:workspace.id ~actor:None Workspace_loaded)
    store workspaces

let of_config ?(config_dir = ".") (config : Workspace_config.t) =
  match Workspace_config.validate config with
  | [] -> Ok (of_validated_config ~config_dir config)
  | errors -> Error errors

let workspaces store = store.workspaces
let audit_events store = List.rev store.audit_events

let summarize store =
  let workspace_count = List.length store.workspaces in
  let agent_count =
    List.fold_left
      (fun count (workspace : workspace) ->
        count + List.length workspace.agents)
      0 store.workspaces
  in
  let event_count = List.length store.audit_events in
  let header =
    Printf.sprintf
      "TA state snapshot: %d workspace(s), %d agent(s), %d audit event(s)"
      workspace_count agent_count event_count
  in
  let lines =
    store.workspaces
    |> List.map (fun (workspace : workspace) ->
        Printf.sprintf "- %s: %d agents, %d links"
          (Id.Workspace.to_string workspace.id)
          (List.length workspace.agents)
          (List.length workspace.links))
  in
  String.concat "\n" (header :: lines)

let pane_to_string = function
  | None -> "-"
  | Some pane -> Id.Pane.to_string pane

let actor_to_string = function
  | None -> "system"
  | Some actor -> Id.Agent.to_string actor

let permissions_to_string permissions =
  permissions |> List.map Permission.to_string |> String.concat ","

let option_to_list = function None -> [] | Some value -> [ value ]

let capabilities_to_string = function
  | [] -> "-"
  | capabilities ->
      capabilities |> List.map Agent_capability.to_string |> String.concat ","

let audit_kind_to_string = function
  | Workspace_loaded -> "workspace-loaded"
  | Agent_status_changed { agent; before; after } ->
      Printf.sprintf "status %s: %s -> %s" (Id.Agent.to_string agent)
        (status_to_string before) (status_to_string after)
  | Pane_attached { agent; pane } ->
      Printf.sprintf "pane %s: %s" (Id.Agent.to_string agent)
        (Id.Pane.to_string pane)

let drop count values =
  let rec loop remaining rest =
    if remaining <= 0 then rest
    else match rest with [] -> [] | _ :: tail -> loop (remaining - 1) tail
  in
  loop count values

let recent_events limit events =
  let limit = max 0 limit in
  let event_count = List.length events in
  drop (event_count - limit) events

let describe_workspace workspace =
  let agent_lines =
    workspace.agents
    |> List.map (fun agent ->
        Printf.sprintf "  - %s [%s] roster=%s pane=%s"
          (Id.Agent.to_string agent.name)
          (status_to_string agent.status)
          agent.roster_agent
          (pane_to_string agent.pane)
        ^ " capabilities="
        ^ capabilities_to_string agent.capabilities)
  in
  let link_lines =
    match workspace.links with
    | [] -> [ "  - none" ]
    | links ->
        links
        |> List.map (fun link ->
            Printf.sprintf "  - %s -> %s [%s] %s"
              (Id.Agent.to_string link.from_agent)
              (Id.Agent.to_string link.to_agent)
              (permissions_to_string link.permissions)
              link.reason)
  in
  let harness_path =
    option_to_list
      (Option.map (fun path -> "  harness_path: " ^ path) workspace.harness_path)
  in
  [
    Printf.sprintf "Workspace %s (%s)"
      (Id.Workspace.to_string workspace.id)
      workspace.label;
    "  root: " ^ workspace.root;
    ("  tmux_session: "
    ^
    match workspace.tmux_session with
    | None -> "-"
    | Some session -> Tmux.session_to_string session);
  ]
  @ harness_path
  @ [
    "  active_view: " ^ Id.View.to_string workspace.active_view;
    "  Agents:";
  ]
  @ agent_lines @ [ "  Links:" ] @ link_lines

let describe_audit_event event =
  Printf.sprintf "  #%d %s actor=%s %s" event.seq
    (Id.Workspace.to_string event.workspace)
    (actor_to_string event.actor)
    (audit_kind_to_string event.kind)

let describe ?(audit_limit = 10) store =
  let events = audit_events store in
  let workspace_lines =
    store.workspaces |> List.concat_map describe_workspace
  in
  let audit_lines =
    match recent_events audit_limit events with
    | [] -> [ "  - none" ]
    | events -> List.map describe_audit_event events
  in
  String.concat "\n"
    ([ summarize store ] @ workspace_lines @ [ "Recent audit:" ] @ audit_lines)

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

let actor_exists workspace actor =
  match find_agent workspace actor with Ok _ -> true | Error _ -> false

let actor_can_read store workspace actor (agent : agent) =
  Id.Agent.equal actor agent.name
  || can_access store ~workspace ~from_agent:actor ~to_agent:agent.name
       Permission.Read

let actor_can_write store workspace actor (agent : agent) =
  can_access store ~workspace ~from_agent:actor ~to_agent:agent.name
    Permission.Write

let visible_agent_names store workspace actor =
  workspace.agents
  |> List.filter (actor_can_read store workspace.id actor)
  |> List.map (fun (agent : agent) -> agent.name)

let action_visible_agent_names store workspace actor =
  workspace.agents
  |> List.filter (fun agent ->
      actor_can_read store workspace.id actor agent
      || actor_can_write store workspace.id actor agent)
  |> List.map (fun (agent : agent) -> agent.name)

let agent_name_visible names agent = List.exists (Id.Agent.equal agent) names

let link_visible names (link : link) =
  agent_name_visible names link.from_agent
  && agent_name_visible names link.to_agent

let actor_outgoing_visible actor names (link : link) =
  Id.Agent.equal actor link.from_agent && agent_name_visible names link.to_agent

let readonly_agent_for_action_target (agent : agent) =
  {
    agent with
    command = [];
    cwd = None;
    env = [];
    startup_prompt = None;
    status = Not_started;
    pane = None;
    pane_identity = None;
  }

let visible_workspace store actor workspace =
  if not (actor_exists workspace actor) then None
  else
    let visible_names = visible_agent_names store workspace actor in
    let agents =
      workspace.agents
      |> List.filter (fun (agent : agent) ->
          agent_name_visible visible_names agent.name)
    in
    let links = workspace.links |> List.filter (link_visible visible_names) in
    Some { workspace with agents; links }

let action_visible_workspace store actor workspace =
  if not (actor_exists workspace actor) then None
  else
    let read_names = visible_agent_names store workspace actor in
    let visible_names = action_visible_agent_names store workspace actor in
    let agents =
      workspace.agents
      |> List.filter_map (fun (agent : agent) ->
          if agent_name_visible read_names agent.name then Some agent
          else if agent_name_visible visible_names agent.name then
            Some (readonly_agent_for_action_target agent)
          else None)
    in
    let links =
      workspace.links
      |> List.filter (fun link ->
          link_visible read_names link
          || actor_outgoing_visible actor visible_names link)
    in
    Some { workspace with agents; links }

let visible_to_actor store ~actor =
  let workspaces =
    store.workspaces |> List.filter_map (visible_workspace store actor)
  in
  match workspaces with
  | [] -> Error ("unknown actor: " ^ Id.Agent.to_string actor)
  | workspaces -> Ok { workspaces; audit_events = []; next_seq = 1 }

let action_visible_to_actor store ~actor =
  let workspaces =
    store.workspaces |> List.filter_map (action_visible_workspace store actor)
  in
  match workspaces with
  | [] -> Error ("unknown actor: " ^ Id.Agent.to_string actor)
  | workspaces -> Ok { workspaces; audit_events = []; next_seq = 1 }

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

let attach_pane ?identity store ~workspace ~agent ~pane ~actor =
  let* current_workspace = find_workspace store workspace in
  let* () = validate_actor current_workspace actor in
  let* _current_agent = find_agent current_workspace agent in
  let* updated =
    update_workspace store workspace (fun workspace ->
        let agents =
          match
            update_agent workspace.agents agent (fun agent ->
                { agent with pane = Some pane; pane_identity = identity })
          with
          | Ok agents -> agents
          | Error _ -> workspace.agents
        in
        { workspace with agents })
  in
  Ok (append_event updated ~workspace ~actor (Pane_attached { agent; pane }))

let require_no_reason status = function
  | None -> Ok status
  | Some _ -> Error "reason is only valid for blocked or failed status"

let require_reason label make = function
  | Some reason when String.trim reason <> "" -> Ok (make reason)
  | _ -> Error (label ^ " status requires a non-empty reason")

let status_of_string ?reason = function
  | "not-started" -> require_no_reason Not_started reason
  | "starting" -> require_no_reason Starting reason
  | "running" -> require_no_reason Running reason
  | "idle" -> require_no_reason Idle reason
  | "done" -> require_no_reason Done reason
  | "blocked" -> require_reason "blocked" (fun reason -> Blocked reason) reason
  | "failed" -> require_reason "failed" (fun reason -> Failed reason) reason
  | value -> Error ("unknown status: " ^ value)
