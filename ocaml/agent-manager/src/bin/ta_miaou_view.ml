module Desc = Miaou_widgets_display.Description_list
module Sidebar = Miaou_widgets_layout.Sidebar_widget
module Table = Miaou_widgets_display.Table_widget
module Widgets = Miaou_widgets_display.Widgets

type profile = { lines : int }

let join_lines = String.concat "\n"

let split_lines value =
  if String.equal value "" then [] else String.split_on_char '\n' value

let clip_lines height lines =
  if height <= 0 then []
  else
    let rec loop remaining acc = function
      | [] -> List.rev acc
      | _ when remaining <= 0 -> List.rev acc
      | line :: rest -> loop (remaining - 1) (line :: acc) rest
    in
    loop height [] lines

let clip_text height value =
  value |> split_lines |> clip_lines height |> join_lines

let sidebar_collapses cols = cols < 40

let sidebar_left_width cols sidebar_width =
  max 10 (min sidebar_width (cols / 2))

let split_main_width cols sidebar_width =
  let inner_width = max 0 (cols - 4) in
  let left_width = min inner_width (sidebar_left_width cols sidebar_width) in
  max 1 (inner_width - left_width - 1)

let split_sidebar_width cols sidebar_width =
  let inner_width = max 0 (cols - 4) in
  let left_width = min inner_width (sidebar_left_width cols sidebar_width) in
  max 1 (left_width - 1)

let option_exists predicate = function
  | None -> false
  | Some value -> predicate value

let runtime_state_to_string = function
  | Ta_core.Dashboard_model.Unknown -> "STALE"
  | Unattached -> "DETACHED"
  | Live -> "LIVE"
  | Missing _ -> "MISSING"

let status_to_string status = Ta_core.State_store.status_to_string status

let pane_to_string = function
  | None -> "-"
  | Some pane -> Ta_core.Id.Pane.to_string pane

let workspace_source_label (workspace : Ta_core.Dashboard_model.workspace) =
  match workspace.harness_path with
  | None -> "TA config"
  | Some path -> "harness " ^ path

let privilege_label (agent : Ta_core.Dashboard_model.agent) =
  let readable = List.length agent.outgoing.readable in
  let writable = List.length agent.outgoing.writable in
  if readable = 0 && writable = 0 then "self only"
  else Printf.sprintf "reads %d | writes %d" readable writable

let capability_label (agent : Ta_core.Dashboard_model.agent) =
  match agent.capabilities with
  | [] -> "none"
  | capabilities ->
      capabilities
      |> List.map Ta_core.Agent_capability.to_string
      |> String.concat ","

let action_bar_for_agent (agent : Ta_core.Dashboard_model.agent) =
  let name = Ta_core.Id.Agent.to_string agent.name in
  match agent.pane with
  | None -> "Enter Start " ^ name
  | Some pane -> "Enter Refresh | attached " ^ Ta_core.Id.Pane.to_string pane

let join_agents values =
  match values with
  | [] -> "-"
  | values -> values |> List.map Ta_core.Id.Agent.to_string |> String.concat ","

let selected_workspace interaction =
  let model = Ta_core.Dashboard_interaction.model interaction in
  match Ta_core.Dashboard_interaction.selected_workspace interaction with
  | None -> None
  | Some selected ->
      model.workspaces
      |> List.find_opt (fun (workspace : Ta_core.Dashboard_model.workspace) ->
          Ta_core.Id.Workspace.equal workspace.id selected)

let selected_agent interaction =
  match
    ( selected_workspace interaction,
      Ta_core.Dashboard_interaction.selected_agent interaction )
  with
  | Some workspace, Some selected ->
      workspace.agents
      |> List.find_opt (fun (agent : Ta_core.Dashboard_model.agent) ->
          Ta_core.Id.Agent.equal agent.name selected)
      |> Option.map (fun agent -> (workspace, agent))
  | _ -> None

let selected_action_line interaction =
  match selected_agent interaction with
  | None -> None
  | Some (_, agent) -> Some (action_bar_for_agent agent)

let selected_agent_index interaction
    (workspace : Ta_core.Dashboard_model.workspace) =
  let selected = Ta_core.Dashboard_interaction.selected_agent interaction in
  let rec loop index = function
    | [] -> 0
    | agent :: _
      when option_exists
             (Ta_core.Id.Agent.equal agent.Ta_core.Dashboard_model.name)
             selected ->
        index
    | _ :: rest -> loop (index + 1) rest
  in
  loop 0 workspace.agents

let workspace_lines interaction =
  let model = Ta_core.Dashboard_interaction.model interaction in
  let selected = Ta_core.Dashboard_interaction.selected_workspace interaction in
  let row (workspace : Ta_core.Dashboard_model.workspace) =
    Printf.sprintf "%s %-12s %d/%d live"
      (if option_exists (Ta_core.Id.Workspace.equal workspace.id) selected then
         ">"
       else " ")
      (Ta_core.Id.Workspace.to_string workspace.id)
      workspace.live_count
      (List.length workspace.agents)
  in
  Widgets.themed_emphasis "Workspaces" :: List.map row model.workspaces

let agent_table width interaction workspace =
  let rows =
    workspace.Ta_core.Dashboard_model.agents
    |> List.map (fun (agent : Ta_core.Dashboard_model.agent) ->
        [ Ta_core.Id.Agent.to_string agent.name; status_to_string agent.status ])
  in
  let opts =
    {
      Table.default_opts with
      selection_mode = Table.Row;
      highlight_header = true;
    }
  in
  Table.render_table_generic_with_opts
    ~cols:(Some (max 20 width))
    ~header_list:[ "Agent"; "Status" ] ~rows_list:rows
    ~cursor:(selected_agent_index interaction workspace)
    ~sel_col:0 ~opts ()

let sidebar_text width interaction =
  let workspaces = workspace_lines interaction |> join_lines in
  let agents =
    match selected_workspace interaction with
    | None -> "Agents\n  no workspace selected"
    | Some workspace ->
        Widgets.themed_emphasis "Agents"
        ^ "\n"
        ^ agent_table (max 20 (width - 2)) interaction workspace
  in
  match selected_action_line interaction with
  | None -> String.concat "\n\n" [ workspaces; agents ]
  | Some action -> (
      match selected_workspace interaction with
      | None -> String.concat "\n\n" [ workspaces; agents; action ]
      | Some workspace ->
          String.concat "\n\n"
            [ workspaces; agents; action; workspace_source_label workspace ])

let roster_label (agent : Ta_core.Dashboard_model.agent) =
  match agent.roster_metadata with
  | None -> agent.roster_agent
  | Some metadata ->
      Option.value metadata.display_name ~default:agent.roster_agent

let agent_detail width workspace agent =
  let items =
    [
      ( "Agent",
        Ta_core.Id.Workspace.to_string workspace.Ta_core.Dashboard_model.id
        ^ "/"
        ^ Ta_core.Id.Agent.to_string agent.Ta_core.Dashboard_model.name );
      ("Status", status_to_string agent.status);
      ("Runtime", runtime_state_to_string agent.runtime_state);
      ("Pane", pane_to_string agent.pane);
      ("Roster", roster_label agent ^ " | id " ^ agent.roster_agent);
      ("Source", workspace_source_label workspace);
      ("Privileges", privilege_label agent);
      ("Capabilities", capability_label agent);
      ( "Connections",
        "read "
        ^ join_agents agent.outgoing.readable
        ^ " | write "
        ^ join_agents agent.outgoing.writable );
      ("Actions", action_bar_for_agent agent);
    ]
  in
  Desc.create ~title:"Agent detail" ~key_width:12 ~items () |> fun desc ->
  Desc.render ~cols:width ~wrap:false desc ~focus:true

let preview_text ?(title = "Preview") lines
    (agent : Ta_core.Dashboard_model.agent) =
  let rec take remaining acc = function
    | [] -> List.rev acc
    | _ when remaining <= 0 -> List.rev acc
    | line :: rest -> take (remaining - 1) (line :: acc) rest
  in
  match agent.preview with
  | [] -> title ^ "\n  no pane output captured"
  | preview -> title ^ "\n" ^ (preview |> take lines [] |> join_lines)

let agent_is_live (agent : Ta_core.Dashboard_model.agent) =
  match agent.runtime_state with Live -> true | _ -> false

let preview_title workspace agent =
  "Preview "
  ^ Ta_core.Id.Workspace.to_string workspace.Ta_core.Dashboard_model.id
  ^ "/"
  ^ Ta_core.Id.Agent.to_string agent.Ta_core.Dashboard_model.name

let focused_preview_text profile workspace agent =
  String.concat "\n\n"
    [
      action_bar_for_agent agent;
      preview_text ~title:(preview_title workspace agent) profile.lines agent;
    ]

let main_text ~preview_focus profile width layout interaction =
  match (preview_focus, selected_agent interaction) with
  | true, Some (workspace, agent) -> focused_preview_text profile workspace agent
  | _ -> (
      match Ta_core.Dashboard_interaction.focus interaction with
      | Pipeline -> layout.Ta_core.Dashboard_tui_layout.main |> join_lines
      | Workspaces | Agents -> (
          match selected_agent interaction with
          | None -> layout.main |> join_lines
          | Some (workspace, agent) ->
              let action = action_bar_for_agent agent in
              let detail = agent_detail width workspace agent in
              let preview = preview_text profile.lines agent in
              if agent_is_live agent then
                String.concat "\n\n" [ action; preview; detail ]
              else String.concat "\n\n" [ action; detail; preview ]))

let preview_focus_active preview_focus interaction =
  preview_focus
  &&
  match selected_agent interaction with
  | Some (_, agent) -> agent_is_live agent
  | None -> false

let render ?(preview_focus = false) profile runner ~size =
  let cols = max 1 size.LTerm_geom.cols in
  let rows = max 1 size.LTerm_geom.rows in
  let interaction = Ta_core.Dashboard_runner.interaction runner in
  let preview_focus = preview_focus_active preview_focus interaction in
  let header_rows = 2 in
  let split_open = not (sidebar_collapses cols) in
  let border_rows = if split_open && not preview_focus then 2 else 0 in
  let body_rows = max 0 (rows - header_rows - border_rows) in
  let layout =
    Ta_core.Dashboard_tui_layout.render ~now:(Unix.gettimeofday ())
      ~lines:profile.lines ~show_footer:false ~width:cols
      ~height:(body_rows + header_rows) interaction
  in
  let header =
    layout.header |> List.map Widgets.themed_emphasis |> clip_lines header_rows
  in
  let sidebar_width =
    if split_open then split_sidebar_width cols layout.sidebar_width else cols
  in
  let main_width =
    if split_open then split_main_width cols layout.sidebar_width else cols
  in
  let sidebar = sidebar_text sidebar_width interaction |> clip_text body_rows in
  let main =
    main_text ~preview_focus profile main_width layout interaction
    |> clip_text body_rows
  in
  let body =
    if preview_focus then main
    else
      Sidebar.create ~sidebar_width:layout.sidebar_width ~sidebar ~main
        ~sidebar_open:true ()
      |> Sidebar.render ~cols
  in
  header @ split_lines body |> clip_lines rows |> join_lines
