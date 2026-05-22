type focus = Workspaces | Agents | Pipeline
type refresh_status = Fresh | Refreshing | Stale of string

type t = {
  model : Dashboard_model.t;
  focus : focus;
  selected_workspace : Id.Workspace.t option;
  selected_agent : Id.Agent.t option;
  selected_edge : Dashboard_topology.edge_id option;
  selected_edge_target : Dashboard_topology.node_id option;
  refresh_requested : bool;
  refresh_status : refresh_status;
  should_quit : bool;
}

let model state = state.model
let focus state = state.focus
let selected_workspace state = state.selected_workspace
let selected_agent state = state.selected_agent
let selected_edge state = state.selected_edge
let selected_edge_target state = state.selected_edge_target

let focused_edge_affordance ?actor ?lines state =
  match (state.focus, state.selected_edge) with
  | Pipeline, Some edge ->
      Dashboard_model.edge_affordance ?actor ?lines
        ?target:state.selected_edge_target edge state.model
  | Pipeline, None | Workspaces, _ | Agents, _ -> None

let refresh_requested state = state.refresh_requested
let refresh_status state = state.refresh_status
let should_quit state = state.should_quit

let first_agent = function
  | [] -> None
  | agent :: _ -> Some agent.Dashboard_model.name

let find_workspace model workspace =
  model.Dashboard_model.workspaces
  |> List.find_opt (fun (candidate : Dashboard_model.workspace) ->
      Id.Workspace.equal candidate.id workspace)

let selected_workspace_state state =
  match state.selected_workspace with
  | None -> None
  | Some workspace -> find_workspace state.model workspace

let model_focus = function
  | Workspaces -> Dashboard_model.Workspaces
  | Agents -> Dashboard_model.Agents
  | Pipeline -> Dashboard_model.Pipeline

let selection state : Dashboard_model.selection =
  { workspace = state.selected_workspace; agent = state.selected_agent }

let init model =
  let selected_workspace, selected_agent =
    match model.Dashboard_model.workspaces with
    | [] -> (None, None)
    | workspace :: _ -> (Some workspace.id, first_agent workspace.agents)
  in
  {
    model;
    focus = Agents;
    selected_workspace;
    selected_agent;
    selected_edge = None;
    selected_edge_target = None;
    refresh_requested = false;
    refresh_status = Fresh;
    should_quit = false;
  }

let select ?workspace ?agent state =
  let workspace =
    match workspace with
    | Some workspace -> Some workspace
    | None -> state.selected_workspace
  in
  match workspace with
  | None -> Ok { state with selected_workspace = None; selected_agent = None }
  | Some workspace_id -> (
      match find_workspace state.model workspace_id with
      | None ->
          Error ("unknown workspace: " ^ Id.Workspace.to_string workspace_id)
      | Some workspace -> (
          match agent with
          | None ->
              let agent =
                match state.selected_agent with
                | Some agent
                  when List.exists
                         (fun candidate ->
                           Id.Agent.equal candidate.Dashboard_model.name agent)
                         workspace.agents ->
                    Some agent
                | _ -> first_agent workspace.agents
              in
              Ok
                {
                  state with
                  selected_workspace = Some workspace.id;
                  selected_agent = agent;
                }
          | Some agent -> (
              match
                workspace.agents
                |> List.find_opt (fun candidate ->
                    Id.Agent.equal candidate.Dashboard_model.name agent)
              with
              | None ->
                  Error
                    (Printf.sprintf "unknown agent: %s in workspace %s"
                       (Id.Agent.to_string agent)
                       (Id.Workspace.to_string workspace.id))
              | Some agent ->
                  Ok
                    {
                      state with
                      selected_workspace = Some workspace.id;
                      selected_agent = Some agent.name;
                    })))

let refresh model state =
  let refreshed = { (init model) with focus = state.focus } in
  let refreshed =
    match
      select ?workspace:state.selected_workspace ?agent:state.selected_agent
        refreshed
    with
    | Ok selected -> selected
    | Error _ -> refreshed
  in
  let topology = Dashboard_model.topology refreshed.model in
  let selected_edge, selected_edge_target =
    match state.selected_edge with
    | Some edge -> (
        match Dashboard_topology.edge_targets edge topology with
        | [] -> (None, None)
        | targets ->
            let selected_target =
              match state.selected_edge_target with
              | Some selected
                when List.exists
                       (Dashboard_topology.equal_node_id selected)
                       targets ->
                  Some selected
              | Some _ | None -> List.find_opt (fun _ -> true) targets
            in
            (Some edge, selected_target))
    | None -> (None, None)
  in
  let refreshed =
    match selected_edge_target with
    | None -> refreshed
    | Some target ->
        select
          ~workspace:(Dashboard_topology.node_workspace target)
          ~agent:(Dashboard_topology.node_agent target)
          { refreshed with selected_edge; selected_edge_target }
        |> Result.value ~default:refreshed
  in
  {
    refreshed with
    selected_edge;
    selected_edge_target;
    refresh_requested = false;
    refresh_status = Fresh;
    should_quit = state.should_quit;
  }

let refresh_failed message state =
  { state with refresh_requested = false; refresh_status = Stale message }

let move_in_list equal get_id direction selected values =
  match values with
  | [] -> None
  | first :: _ -> (
      let ids = List.map get_id values in
      match selected with
      | None -> Some (get_id first)
      | Some selected ->
          let rec loop previous = function
            | [] -> (
                match direction with
                | `Next -> Some (get_id first)
                | `Previous -> previous)
            | value :: rest ->
                let id = get_id value in
                if equal id selected then
                  match direction with
                  | `Next -> (
                      match rest with
                      | next :: _ -> Some (get_id next)
                      | [] -> Some (get_id first))
                  | `Previous -> (
                      match previous with
                      | Some previous -> Some previous
                      | None -> List.rev ids |> List.find_opt (fun _ -> true))
                else loop (Some id) rest
          in
          loop None values)

let move_workspace direction state =
  let workspace =
    move_in_list Id.Workspace.equal
      (fun (workspace : Dashboard_model.workspace) -> workspace.id)
      direction state.selected_workspace state.model.workspaces
  in
  match
    select ?workspace
      { state with selected_edge = None; selected_edge_target = None }
  with
  | Ok state -> state
  | Error _ -> state

let move_agent direction state =
  match selected_workspace_state state with
  | None -> state
  | Some workspace -> (
      let agent =
        move_in_list Id.Agent.equal
          (fun (agent : Dashboard_model.agent) -> agent.name)
          direction state.selected_agent workspace.agents
      in
      match
        select ~workspace:workspace.id ?agent
          { state with selected_edge = None; selected_edge_target = None }
      with
      | Ok state -> state
      | Error _ -> state)

let selected_topology_node state =
  match (state.selected_workspace, state.selected_agent) with
  | Some workspace, Some agent ->
      Some (Dashboard_topology.node_id ~workspace ~agent)
  | _ -> None

let topology_focus state =
  match (state.focus, state.selected_edge) with
  | Pipeline, Some edge -> Some (Dashboard_topology.Edge edge)
  | Pipeline, None ->
      Option.map
        (fun node -> Dashboard_topology.Node node)
        (selected_topology_node state)
  | Workspaces, _ | Agents, _ -> None

let select_node ?(clear_edge = true) selected state =
  let state =
    if clear_edge then
      { state with selected_edge = None; selected_edge_target = None }
    else state
  in
  select
    ~workspace:(Dashboard_topology.node_workspace selected)
    ~agent:(Dashboard_topology.node_agent selected)
    state
  |> Result.value ~default:state

let move_pipeline direction state =
  match
    Dashboard_topology.move direction
      ~selected:(selected_topology_node state)
      (Dashboard_model.topology state.model)
  with
  | None -> state
  | Some selected -> select_node selected state

let outgoing_edge_for_node topology node =
  topology.Dashboard_topology.declared_acl_edges
  |> List.find_opt (fun (edge : Dashboard_topology.acl_edge) ->
      Id.Workspace.equal edge.workspace (Dashboard_topology.node_workspace node)
      && Id.Agent.equal edge.from_agent (Dashboard_topology.node_agent node))
  |> Option.map (fun (edge : Dashboard_topology.acl_edge) ->
      Dashboard_topology.edge_id ~workspace:edge.workspace
        ~from_agent:edge.from_agent)

let move_pipeline_edge direction state =
  let topology = Dashboard_model.topology state.model in
  let selected =
    match (direction, state.selected_edge, selected_topology_node state) with
    | `Next, None, Some node -> outgoing_edge_for_node topology node
    | _ -> None
  in
  let selected =
    match selected with
    | Some selected -> Some selected
    | None ->
        Dashboard_topology.move_edge direction ~selected:state.selected_edge
          topology
  in
  match selected with
  | None -> state
  | Some selected -> (
      match Dashboard_topology.edge_targets selected topology with
      | [] ->
          {
            state with
            focus = Pipeline;
            selected_edge = Some selected;
            selected_edge_target = None;
          }
      | target :: _ ->
          select_node ~clear_edge:false target
            {
              state with
              focus = Pipeline;
              selected_edge = Some selected;
              selected_edge_target = Some target;
            })

let move_edge_target direction state =
  match state.selected_edge with
  | None -> state
  | Some edge -> (
      let topology = Dashboard_model.topology state.model in
      let targets = Dashboard_topology.edge_targets edge topology in
      match
        move_in_list Dashboard_topology.equal_node_id
          (fun node -> node)
          direction state.selected_edge_target targets
      with
      | None -> state
      | Some target ->
          select_node ~clear_edge:false target
            { state with selected_edge_target = Some target })

let move direction state =
  match state.focus with
  | Workspaces -> move_workspace direction state
  | Agents -> move_agent direction state
  | Pipeline -> move_pipeline direction state

let next_focus = function
  | Agents -> Pipeline
  | Pipeline -> Workspaces
  | Workspaces -> Agents

let handle_key state = function
  | "q" | "Q" -> { state with should_quit = true }
  | "r" | "R" ->
      { state with refresh_requested = true; refresh_status = Refreshing }
  | "Tab" -> { state with focus = next_focus state.focus }
  | "w" | "W" -> { state with focus = Workspaces }
  | "a" | "A" -> { state with focus = Agents }
  | "p" | "P" -> { state with focus = Pipeline }
  | "]" -> (
      match state.focus with
      | Pipeline -> move_edge_target `Next state
      | Workspaces | Agents -> state)
  | "[" -> (
      match state.focus with
      | Pipeline -> move_edge_target `Previous state
      | Workspaces | Agents -> state)
  | "j" | "J" | "Down" -> move `Next state
  | "k" | "K" | "Up" -> move `Previous state
  | "Right" | "l" | "L" -> (
      match state.focus with
      | Pipeline -> move_pipeline_edge `Next state
      | Workspaces | Agents -> move_agent `Next { state with focus = Agents })
  | "Left" | "h" | "H" -> (
      match state.focus with
      | Pipeline -> move_pipeline_edge `Previous state
      | Workspaces | Agents ->
          move_agent `Previous { state with focus = Agents })
  | _ -> state

let refresh_age_label ~now captured_at =
  let age = max 0.0 (now -. captured_at) in
  if age < 1.0 then "just now"
  else if age < 60.0 then Printf.sprintf "%.1fs ago" age
  else if age < 3600.0 then Printf.sprintf "%.1fm ago" (age /. 60.0)
  else Printf.sprintf "%.1fh ago" (age /. 3600.0)

let render ?(now = Unix.gettimeofday ()) ?width ?lines ?actor state =
  let dashboard =
    Dashboard_model.render ?width ?lines ?actor ~selection:(selection state)
      ~focus:(model_focus state.focus) ?topology_focus:(topology_focus state)
      ?edge_target:state.selected_edge_target state.model
  in
  let captured =
    match state.model.captured_at with
    | None -> []
    | Some captured_at ->
        [ "Last refresh: " ^ refresh_age_label ~now captured_at ]
  in
  let refresh =
    match state.refresh_status with
    | Fresh -> []
    | Refreshing -> [ "Refresh: REQUESTED" ]
    | Stale message -> [ "Refresh: STALE - " ^ message ]
  in
  String.concat "\n" (refresh @ captured @ [ dashboard ])
