type focus = Workspaces | Agents

type t = {
  model : Dashboard_model.t;
  focus : focus;
  selected_workspace : Id.Workspace.t option;
  selected_agent : Id.Agent.t option;
  refresh_requested : bool;
  should_quit : bool;
}

let model state = state.model
let focus state = state.focus
let selected_workspace state = state.selected_workspace
let selected_agent state = state.selected_agent
let refresh_requested state = state.refresh_requested
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
    refresh_requested = false;
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
  { refreshed with refresh_requested = false; should_quit = state.should_quit }

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
  match select ?workspace state with Ok state -> state | Error _ -> state

let move_agent direction state =
  match selected_workspace_state state with
  | None -> state
  | Some workspace -> (
      let agent =
        move_in_list Id.Agent.equal
          (fun (agent : Dashboard_model.agent) -> agent.name)
          direction state.selected_agent workspace.agents
      in
      match select ~workspace:workspace.id ?agent state with
      | Ok state -> state
      | Error _ -> state)

let move direction state =
  match state.focus with
  | Workspaces -> move_workspace direction state
  | Agents -> move_agent direction state

let handle_key state = function
  | "q" | "Q" -> { state with should_quit = true }
  | "r" | "R" -> { state with refresh_requested = true }
  | "Tab" ->
      {
        state with
        focus =
          (match state.focus with Workspaces -> Agents | Agents -> Workspaces);
      }
  | "w" | "W" -> { state with focus = Workspaces }
  | "a" | "A" -> { state with focus = Agents }
  | "j" | "J" | "Down" -> move `Next state
  | "k" | "K" | "Up" -> move `Previous state
  | "Right" | "l" | "L" -> move_agent `Next { state with focus = Agents }
  | "Left" | "h" | "H" -> move_agent `Previous { state with focus = Agents }
  | _ -> state

let render ?width state =
  Dashboard_model.render ?width ~selection:(selection state) state.model
