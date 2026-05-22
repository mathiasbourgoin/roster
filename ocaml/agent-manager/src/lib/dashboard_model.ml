type runtime_state = Unknown | Unattached | Live | Missing of string
type connections = { readable : Id.Agent.t list; writable : Id.Agent.t list }

type roster_metadata = {
  display_name : string option;
  description : string option;
  domain : string list;
  tags : string list;
  model : string option;
  complexity : string option;
  compatible_with : string list;
  version : string option;
  author : string option;
  isolation : string option;
  pipeline_role : Roster_pipeline_role.t option;
  source : string option;
}

type agent = {
  workspace : Id.Workspace.t;
  name : Id.Agent.t;
  roster_agent : string;
  roster_metadata : roster_metadata option;
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

type focus = Workspaces | Agents | Pipeline

type selection = {
  workspace : Id.Workspace.t option;
  agent : Id.Agent.t option;
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
        roster_metadata = None;
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
        roster_metadata = None;
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

let metadata_of_entry (entry : Roster_index.entry) =
  {
    display_name = entry.display_name;
    description = entry.description;
    domain = entry.domain;
    tags = entry.tags;
    model = entry.model;
    complexity = entry.complexity;
    compatible_with = entry.compatible_with;
    version = entry.version;
    author = entry.author;
    isolation = entry.isolation;
    pipeline_role = entry.pipeline_role;
    source = entry.source;
  }

let enrich_agent roster agent =
  match Roster_index.find_agent roster agent.roster_agent with
  | None -> agent
  | Some entry ->
      { agent with roster_metadata = Some (metadata_of_entry entry) }

let enrich_workspace roster workspace =
  { workspace with agents = List.map (enrich_agent roster) workspace.agents }

let enrich_with_roster roster model =
  {
    model with
    workspaces = List.map (enrich_workspace roster) model.workspaces;
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

let first_nonempty = function [] -> None | value :: _ -> Some value
let compact_source = function None -> "?" | Some source -> source
let compact_optional = function None -> "-" | Some value -> value
let join_text values = String.concat "," values

let compact_metadata agent =
  match agent.roster_metadata with
  | None -> agent.roster_agent
  | Some metadata ->
      let label =
        Option.value metadata.display_name ~default:agent.roster_agent
      in
      let domain = Option.value (first_nonempty metadata.domain) ~default:"-" in
      Printf.sprintf "%s/%s" label domain

let roster_profile_line metadata =
  match (metadata.model, metadata.complexity, metadata.isolation) with
  | None, None, None -> None
  | _ ->
      Some
        (Printf.sprintf "Profile: model %s | complexity %s | isolation %s"
           (compact_optional metadata.model)
           (compact_optional metadata.complexity)
           (compact_optional metadata.isolation))

let roster_compatibility_line metadata =
  let compatible =
    match metadata.compatible_with with
    | [] -> "-"
    | compatible -> join_text compatible
  in
  match (metadata.compatible_with, metadata.version, metadata.author) with
  | [], None, None -> None
  | _ ->
      Some
        (Printf.sprintf "Compat: %s | version %s | author %s" compatible
           (compact_optional metadata.version)
           (compact_optional metadata.author))

let roster_description_line metadata =
  match metadata.description with
  | None -> None
  | Some description when String.equal description "" -> None
  | Some description -> Some ("Role: " ^ description)

let roster_pipeline_lines metadata =
  match metadata.pipeline_role with
  | None -> []
  | Some pipeline_role ->
      [
        "Pipeline: triggered by "
        ^ Roster_pipeline_role.triggered_by_to_string pipeline_role.triggered_by;
        "Receives: "
        ^ Roster_pipeline_role.receives_to_string pipeline_role.receives;
        "Produces: "
        ^ Roster_pipeline_role.produces_to_string pipeline_role.produces;
        "Human gate: "
        ^ Roster_pipeline_role.human_gate_to_string pipeline_role.human_gate;
      ]

let option_to_list = function None -> [] | Some value -> [ value ]

let roster_preview_lines agent =
  match agent.roster_metadata with
  | None -> []
  | Some metadata ->
      let label =
        Option.value metadata.display_name ~default:agent.roster_agent
      in
      let domain =
        match metadata.domain with [] -> "-" | domain -> join_text domain
      in
      let tags =
        match metadata.tags with [] -> "-" | tags -> join_text tags
      in
      let roster =
        Printf.sprintf "Roster: %s | domain %s | source %s | tags %s" label
          domain
          (compact_source metadata.source)
          tags
      in
      (roster :: option_to_list (roster_profile_line metadata))
      @ option_to_list (roster_compatibility_line metadata)
      @ option_to_list (roster_description_line metadata)
      @ roster_pipeline_lines metadata

let rule width = String.make width '-'

let workspace_line selected workspace =
  Printf.sprintf "%s %-16s %-22s live %d/%d  blocked %d  failed %d  links %d"
    (if selected then ">" else " ")
    (fit 16 (Id.Workspace.to_string workspace.id))
    (fit 22 workspace.label) workspace.live_count
    (List.length workspace.agents)
    workspace.blocked_count workspace.failed_count workspace.link_count

let agent_line selected workspace agent =
  let acl =
    Printf.sprintf "R:%s W:%s"
      (join_agent_ids agent.outgoing.readable)
      (join_agent_ids agent.outgoing.writable)
  in
  Printf.sprintf "%s %-9s %-12s %-12s %-7s %-8s %-20s %s"
    (if selected then ">" else " ")
    (fit 9 (Id.Workspace.to_string workspace.id))
    (fit 12 (Id.Agent.to_string agent.name))
    (fit 12 (status_to_string agent.status))
    (fit 7 (pane_to_string agent.pane))
    (fit 8 (runtime_state_to_string agent.runtime_state))
    (fit 20 (compact_metadata agent))
    (fit 18 acl)

let pipeline_stage_label agent =
  match agent.roster_metadata with
  | Some metadata -> (
      match metadata.display_name with
      | Some display_name -> display_name
      | None -> agent.roster_agent)
  | None -> agent.roster_agent

let pipeline_contract_state agent =
  match agent.roster_metadata with
  | Some { pipeline_role = Some _; _ } -> Dashboard_topology.Contract
  | _ -> Dashboard_topology.Unknown

let topology_node workspace agent : Dashboard_topology.node =
  {
    id = Dashboard_topology.node_id ~workspace:workspace.id ~agent:agent.name;
    role = pipeline_stage_label agent;
    contract = pipeline_contract_state agent;
    status = status_to_string agent.status;
  }

let visible_agent_ids workspaces =
  workspaces
  |> List.concat_map (fun workspace ->
      List.map
        (fun agent ->
          Dashboard_topology.node_id ~workspace:workspace.id ~agent:agent.name)
        workspace.agents)

let visible_agent visible_ids workspace agent =
  let candidate = Dashboard_topology.node_id ~workspace ~agent in
  List.exists (Dashboard_topology.equal_node_id candidate) visible_ids

let topology_edge visible_ids workspace agent =
  let filter_visible = List.filter (visible_agent visible_ids workspace.id) in
  match
    ( filter_visible agent.outgoing.readable,
      filter_visible agent.outgoing.writable )
  with
  | [], [] -> None
  | readable, writable ->
      Some
        {
          Dashboard_topology.workspace = workspace.id;
          from_agent = agent.name;
          readable;
          writable;
        }

let topology model =
  let visible_ids = visible_agent_ids model.workspaces in
  let nodes =
    model.workspaces
    |> List.concat_map (fun workspace ->
        List.map (topology_node workspace) workspace.agents)
  in
  let declared_acl_edges =
    model.workspaces
    |> List.concat_map (fun workspace ->
        List.filter_map (topology_edge visible_ids workspace) workspace.agents)
  in
  { Dashboard_topology.nodes; declared_acl_edges }

let selection_workspace selection =
  match selection with None -> None | Some selection -> selection.workspace

let selection_agent selection =
  match selection with None -> None | Some selection -> selection.agent

let selected_workspace_id workspaces selection =
  match selection_workspace selection with
  | Some workspace -> Some workspace
  | None -> (
      match workspaces with [] -> None | workspace :: _ -> Some workspace.id)

let is_selected_workspace selected workspace =
  match selected with
  | Some selected -> Id.Workspace.equal selected workspace.id
  | None -> false

let is_selected_agent selected_workspace selected_agent workspace agent =
  match (selected_workspace, selected_agent) with
  | Some selected_workspace, Some selected_agent ->
      Id.Workspace.equal selected_workspace workspace.id
      && Id.Agent.equal selected_agent agent.name
  | _ -> false

let find_selected_agent workspaces selected_workspace selected_agent =
  match (selected_workspace, selected_agent) with
  | Some selected_workspace, Some selected_agent ->
      workspaces
      |> List.find_map (fun workspace ->
          if Id.Workspace.equal selected_workspace workspace.id then
            workspace.agents
            |> List.find_opt (fun agent ->
                Id.Agent.equal selected_agent agent.name)
            |> Option.map (fun agent -> (workspace, agent))
          else None)
  | _ -> None

let preview_candidate workspaces selection =
  let selected_workspace = selected_workspace_id workspaces selection in
  let selected_agent = selection_agent selection in
  match find_selected_agent workspaces selected_workspace selected_agent with
  | Some value -> Some value
  | None -> (
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
      | None -> List.find_opt (fun _ -> true) agents)

let preview_lines width workspaces selection =
  match preview_candidate workspaces selection with
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
      let metadata = roster_preview_lines agent |> List.map (fit width) in
      (fit width header :: metadata) @ body

let render ?(width = 100) ?selection ?focus model =
  let width = clamp_width width in
  let totals = model.totals in
  let selected_workspace = selected_workspace_id model.workspaces selection in
  let selected_agent = selection_agent selection in
  let selected_topology_node =
    match (selected_workspace, selected_agent) with
    | Some workspace, Some agent ->
        Some (Dashboard_topology.node_id ~workspace ~agent)
    | _ -> None
  in
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
    | _ ->
        "Workspaces"
        :: List.map
             (fun workspace ->
               workspace_line
                 (is_selected_workspace selected_workspace workspace)
                 workspace
               |> fit width)
             model.workspaces
  in
  let agent_lines =
    let rows =
      model.workspaces
      |> List.concat_map (fun workspace ->
          List.map
            (fun agent ->
              agent_line
                (is_selected_agent selected_workspace selected_agent workspace
                   agent)
                workspace agent)
            workspace.agents)
    in
    "Agents"
    :: fit width
         "  WORKSPACE AGENT        STATUS       PANE    RUNTIME  ROSTER      \
          CONNECTIONS"
    ::
    (match rows with
    | [] -> [ "  none" ]
    | rows -> List.map (fit width) rows)
  in
  let pipeline =
    Dashboard_topology.render ~width
      ~focused:
        (match focus with
        | Some Pipeline -> true
        | Some Workspaces | Some Agents | None -> false)
      ~selected:selected_topology_node (topology model)
  in
  let preview = preview_lines width model.workspaces selection in
  String.concat "\n"
    ([ header; rule width ]
    @ workspace_lines
    @ [ rule width ]
    @ agent_lines
    @ [ rule width ]
    @ pipeline
    @ [ rule width ]
    @ preview)
