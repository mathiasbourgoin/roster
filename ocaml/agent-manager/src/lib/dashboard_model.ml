type runtime_state = Unknown | Unattached | Live | Missing of string
type connections = { readable : Id.Agent.t list; writable : Id.Agent.t list }

type agent = {
  workspace : Id.Workspace.t;
  name : Id.Agent.t;
  roster_agent : string;
  status : State_store.agent_status;
  pane : Id.Pane.t option;
  runtime_state : runtime_state;
  preview : string list;
  outgoing : connections;
}

type workspace = {
  id : Id.Workspace.t;
  label : string;
  root : string;
  tmux_session : Tmux.session option;
  active_view : Id.View.t;
  agents : agent list;
  link_count : int;
  live_count : int;
  blocked_count : int;
  failed_count : int;
}

type totals = {
  workspace_count : int;
  agent_count : int;
  live_count : int;
  blocked_count : int;
  failed_count : int;
}

type t = {
  captured_at : float option;
  workspaces : workspace list;
  totals : totals;
}

let runtime_state_of_snapshot = function
  | Runtime_snapshot.Unattached -> Unattached
  | Runtime_snapshot.Live -> Live
  | Runtime_snapshot.Missing message -> Missing message

let find_runtime_agent runtime workspace agent =
  runtime.Runtime_snapshot.workspaces
  |> List.find_map (fun (runtime_workspace : Runtime_snapshot.workspace) ->
      if Id.Workspace.equal runtime_workspace.id workspace then
        runtime_workspace.agents
        |> List.find_opt (fun (runtime_agent : Runtime_snapshot.agent) ->
            Id.Agent.equal runtime_agent.name agent)
      else None)

let has_permission permission permissions =
  List.exists (Permission.equal permission) permissions

let sorted_agents agents = List.sort Id.Agent.compare agents

let connections_for links agent =
  let readable, writable =
    List.fold_left
      (fun (readable, writable) (link : State_store.link) ->
        if Id.Agent.equal link.from_agent agent then
          ( (if has_permission Permission.Read link.permissions then
               link.to_agent :: readable
             else readable),
            if has_permission Permission.Write link.permissions then
              link.to_agent :: writable
            else writable )
        else (readable, writable))
      ([], []) links
  in
  { readable = sorted_agents readable; writable = sorted_agents writable }

let status_is_blocked = function State_store.Blocked _ -> true | _ -> false
let status_is_failed = function State_store.Failed _ -> true | _ -> false

let agent_of_state runtime workspace_id links (agent : State_store.agent) =
  match find_runtime_agent runtime workspace_id agent.name with
  | None ->
      {
        workspace = workspace_id;
        name = agent.name;
        roster_agent = agent.roster_agent;
        status = agent.status;
        pane = agent.pane;
        runtime_state = Unknown;
        preview = [];
        outgoing = connections_for links agent.name;
      }
  | Some runtime_agent ->
      {
        workspace = workspace_id;
        name = agent.name;
        roster_agent = agent.roster_agent;
        status = agent.status;
        pane = runtime_agent.pane;
        runtime_state = runtime_state_of_snapshot runtime_agent.pane_state;
        preview = runtime_agent.preview;
        outgoing = connections_for links agent.name;
      }

let count_if predicate values =
  List.fold_left
    (fun count value -> if predicate value then count + 1 else count)
    0 values

let workspace_of_state runtime (workspace : State_store.workspace) =
  let agents =
    List.map
      (agent_of_state runtime workspace.id workspace.links)
      workspace.agents
  in
  {
    id = workspace.id;
    label = workspace.label;
    root = workspace.root;
    tmux_session = workspace.tmux_session;
    active_view = workspace.active_view;
    agents;
    link_count = List.length workspace.links;
    live_count =
      count_if
        (fun agent ->
          match agent.runtime_state with Live -> true | _ -> false)
        agents;
    blocked_count =
      count_if (fun agent -> status_is_blocked agent.status) agents;
    failed_count = count_if (fun agent -> status_is_failed agent.status) agents;
  }

let totals (workspaces : workspace list) =
  {
    workspace_count = List.length workspaces;
    agent_count =
      List.fold_left
        (fun count (workspace : workspace) ->
          count + List.length workspace.agents)
        0 workspaces;
    live_count =
      List.fold_left
        (fun count (workspace : workspace) -> count + workspace.live_count)
        0 workspaces;
    blocked_count =
      List.fold_left
        (fun count (workspace : workspace) -> count + workspace.blocked_count)
        0 workspaces;
    failed_count =
      List.fold_left
        (fun count (workspace : workspace) -> count + workspace.failed_count)
        0 workspaces;
  }

let of_state_runtime store runtime =
  let workspaces =
    State_store.workspaces store |> List.map (workspace_of_state runtime)
  in
  {
    captured_at = Some runtime.captured_at;
    workspaces;
    totals = totals workspaces;
  }

let clamp_width width = max 72 (min 160 width)

let fit width value =
  let length = String.length value in
  if width <= 0 then ""
  else if length = width then value
  else if length < width then value ^ String.make (width - length) ' '
  else if width <= 3 then String.sub value 0 width
  else String.sub value 0 (width - 3) ^ "..."

let join_agent_ids = function
  | [] -> "-"
  | agents -> agents |> List.map Id.Agent.to_string |> String.concat ","

let pane_to_string = function
  | None -> "-"
  | Some pane -> Id.Pane.to_string pane

let runtime_state_to_string = function
  | Unknown -> "STALE"
  | Unattached -> "DETACHED"
  | Live -> "LIVE"
  | Missing _ -> "MISSING"

let status_to_string status =
  State_store.status_to_string status |> fit 18 |> String.trim

let rule width = String.make width '-'

let workspace_line selected workspace =
  Printf.sprintf "%s %-16s %-22s live %d/%d  blocked %d  failed %d  links %d"
    (if selected then ">" else " ")
    (fit 16 (Id.Workspace.to_string workspace.id))
    (fit 22 workspace.label) workspace.live_count
    (List.length workspace.agents)
    workspace.blocked_count workspace.failed_count workspace.link_count

let agent_line workspace agent =
  let acl =
    Printf.sprintf "R:%s W:%s"
      (join_agent_ids agent.outgoing.readable)
      (join_agent_ids agent.outgoing.writable)
  in
  Printf.sprintf "%-12s %-14s %-16s %-9s %-8s %s"
    (fit 12 (Id.Workspace.to_string workspace.id))
    (fit 14 (Id.Agent.to_string agent.name))
    (fit 16 (status_to_string agent.status))
    (fit 9 (pane_to_string agent.pane))
    (fit 8 (runtime_state_to_string agent.runtime_state))
    (fit 24 acl)

let preview_candidate workspaces =
  let agents =
    workspaces
    |> List.concat_map (fun workspace ->
        List.map (fun agent -> (workspace, agent)) workspace.agents)
  in
  match
    List.find_opt
      (fun (_, agent) ->
        match agent.runtime_state with
        | Live -> agent.preview <> []
        | _ -> false)
      agents
  with
  | Some value -> Some value
  | None -> List.find_opt (fun _ -> true) agents

let preview_lines width workspaces =
  match preview_candidate workspaces with
  | None -> [ "Preview: none"; "No agents available." ]
  | Some (workspace, agent) ->
      let header =
        Printf.sprintf "Preview: %s/%s"
          (Id.Workspace.to_string workspace.id)
          (Id.Agent.to_string agent.name)
      in
      let body =
        match agent.preview with
        | [] -> [ "(no pane preview captured)" ]
        | lines -> List.map (fit width) lines
      in
      fit width header :: body

let render ?(width = 100) model =
  let width = clamp_width width in
  let totals = model.totals in
  let header =
    Printf.sprintf
      "TA Dashboard | workspaces %d | agents %d | live %d | blocked %d | \
       failed %d"
      totals.workspace_count totals.agent_count totals.live_count
      totals.blocked_count totals.failed_count
    |> fit width
  in
  let workspace_lines =
    match model.workspaces with
    | [] -> [ "Workspaces"; "  none" ]
    | first :: _ ->
        "Workspaces"
        :: List.map
             (fun workspace ->
               workspace_line
                 (Id.Workspace.equal workspace.id first.id)
                 workspace
               |> fit width)
             model.workspaces
  in
  let agent_lines =
    let rows =
      model.workspaces
      |> List.concat_map (fun workspace ->
          List.map (agent_line workspace) workspace.agents)
    in
    "Agents"
    :: fit width
         "WORKSPACE    AGENT          STATUS           PANE      RUNTIME  \
          CONNECTIONS"
    ::
    (match rows with
    | [] -> [ "  none" ]
    | rows -> List.map (fit width) rows)
  in
  let preview = preview_lines width model.workspaces in
  String.concat "\n"
    ([ header; rule width ]
    @ workspace_lines
    @ [ rule width ]
    @ agent_lines
    @ [ rule width ]
    @ preview)
