type section = string list

type t = {
  header : section;
  sidebar : section;
  main : section;
  footer : section;
  sidebar_width : int;
  main_width : int;
  separator : string;
}

let clamp minimum maximum value = max minimum (min maximum value)

let fit width value =
  let length = String.length value in
  if width <= 0 then ""
  else if length = width then value
  else if length < width then value ^ String.make (width - length) ' '
  else if width <= 3 then String.sub value 0 width
  else String.sub value 0 (width - 3) ^ "..."

let trim_fit width value = fit width value |> String.trim
let rule width = String.make (max 0 width) '-'

let option_exists predicate = function
  | None -> false
  | Some value -> predicate value

let runtime_state_to_string = function
  | Dashboard_model.Unknown -> "STALE"
  | Unattached -> "DETACHED"
  | Live -> "LIVE"
  | Missing _ -> "MISSING"

let selected_workspace state =
  let model = Dashboard_interaction.model state in
  match Dashboard_interaction.selected_workspace state with
  | None -> None
  | Some selected ->
      model.workspaces
      |> List.find_opt (fun (workspace : Dashboard_model.workspace) ->
          Id.Workspace.equal workspace.id selected)

let selected_agent state =
  match
    (selected_workspace state, Dashboard_interaction.selected_agent state)
  with
  | Some workspace, Some selected ->
      workspace.agents
      |> List.find_opt (fun (agent : Dashboard_model.agent) ->
          Id.Agent.equal agent.name selected)
      |> Option.map (fun agent -> (workspace, agent))
  | _ -> None

let focus_to_string = function
  | Dashboard_interaction.Workspaces -> "workspaces"
  | Agents -> "agents"
  | Pipeline -> "pipeline"

let refresh_to_string = function
  | Dashboard_interaction.Fresh -> "fresh"
  | Refreshing -> "refreshing"
  | Stale message -> "stale: " ^ message

let status_to_string status = State_store.status_to_string status

let roster_label (agent : Dashboard_model.agent) =
  match agent.roster_metadata with
  | None -> agent.roster_agent
  | Some metadata ->
      Option.value metadata.display_name ~default:agent.roster_agent

let maybe_line label = function
  | None -> []
  | Some value when String.equal value "" -> []
  | Some value -> [ label ^ value ]

let agent_description (agent : Dashboard_model.agent) =
  match agent.roster_metadata with
  | None -> []
  | Some metadata -> maybe_line "Role: " metadata.description

let agent_profile (agent : Dashboard_model.agent) =
  match agent.roster_metadata with
  | None -> []
  | Some metadata ->
      let domain =
        match metadata.domain with
        | [] -> "-"
        | values -> String.concat "," values
      in
      let model = Option.value metadata.model ~default:"-" in
      [
        Printf.sprintf "Roster: %s | domain %s | model %s" (roster_label agent)
          domain model;
      ]

let join_agents values =
  match values with
  | [] -> "-"
  | values -> values |> List.map Id.Agent.to_string |> String.concat ","

let pane_to_string = function
  | None -> "-"
  | Some pane -> Id.Pane.to_string pane

let workspace_source_label (workspace : Dashboard_model.workspace) =
  match workspace.harness_path with
  | None -> "TA config"
  | Some path -> "harness " ^ path

let privilege_label (agent : Dashboard_model.agent) =
  let readable = List.length agent.outgoing.readable in
  let writable = List.length agent.outgoing.writable in
  if readable = 0 && writable = 0 then "self only"
  else Printf.sprintf "reads %d | writes %d" readable writable

let capability_label (agent : Dashboard_model.agent) =
  match agent.capabilities with
  | [] -> "none"
  | capabilities ->
      capabilities |> List.map Agent_capability.to_string |> String.concat ","

let launch_command_label agent =
  Launch_profile.of_parts ~command:agent.Dashboard_model.command
    ~cwd:agent.cwd ~env:agent.env ~startup_prompt:agent.startup_prompt
  |> Launch_profile.full_command_label

let header ?(now = Unix.gettimeofday ()) width state =
  let model = Dashboard_interaction.model state in
  let totals = model.totals in
  let captured =
    match model.captured_at with
    | None -> "no runtime"
    | Some captured_at ->
        let age = max 0.0 (now -. captured_at) in
        if age < 1.0 then "just now"
        else if age < 60.0 then Printf.sprintf "%.1fs ago" age
        else Printf.sprintf "%.1fm ago" (age /. 60.0)
  in
  [
    fit width
      (Printf.sprintf
         "TA Dashboard | %d workspace | %d agents | live %d | blocked %d | \
          failed %d"
         totals.workspace_count totals.agent_count totals.live_count
         totals.blocked_count totals.failed_count);
    fit width
      (Printf.sprintf "focus %s | refresh %s | captured %s"
         (focus_to_string (Dashboard_interaction.focus state))
         (refresh_to_string (Dashboard_interaction.refresh_status state))
         captured);
  ]

let workspace_row width selected (workspace : Dashboard_model.workspace) =
  fit width
    (Printf.sprintf "%s %-12s live %d/%d fail %d"
       (if selected then ">" else " ")
       (trim_fit 12 (Id.Workspace.to_string workspace.id))
       workspace.live_count
       (List.length workspace.agents)
       workspace.failed_count)

let agent_row width selected (agent : Dashboard_model.agent) =
  fit width
    (Printf.sprintf "%s %-12s %-9s %s"
       (if selected then ">" else " ")
       (trim_fit 12 (Id.Agent.to_string agent.name))
       (trim_fit 9 (status_to_string agent.status))
       (runtime_state_to_string agent.runtime_state))

let sidebar width state =
  let model = Dashboard_interaction.model state in
  let selected_workspace_id = Dashboard_interaction.selected_workspace state in
  let selected_agent_id = Dashboard_interaction.selected_agent state in
  let workspace_lines =
    model.workspaces
    |> List.map (fun (workspace : Dashboard_model.workspace) ->
        workspace_row width
          (option_exists
             (Id.Workspace.equal workspace.id)
             selected_workspace_id)
          workspace)
  in
  let agent_lines =
    match selected_workspace state with
    | None -> [ fit width "  no agents" ]
    | Some workspace ->
        workspace.agents
        |> List.map (fun (agent : Dashboard_model.agent) ->
            agent_row width
              (option_exists (Id.Agent.equal agent.name) selected_agent_id)
              agent)
  in
  [ fit width "Workspaces"; rule width ]
  @ workspace_lines
  @ [ rule width; fit width "Agents"; rule width ]
  @ agent_lines

let preview_lines lines agent =
  match agent.Dashboard_model.preview with
  | [] -> [ "Preview: no pane output captured" ]
  | preview -> "Preview:" :: List.filteri (fun idx _ -> idx < lines) preview

let selected_agent_main width lines workspace agent =
  let connections =
    Printf.sprintf "Connections: read %s | write %s"
      (join_agents agent.Dashboard_model.outgoing.readable)
      (join_agents agent.outgoing.writable)
  in
  [
    "Agent "
    ^ Id.Workspace.to_string workspace.Dashboard_model.id
    ^ "/"
    ^ Id.Agent.to_string agent.name;
    rule width;
    "Status: " ^ status_to_string agent.status;
    "Runtime: "
    ^ runtime_state_to_string agent.runtime_state
    ^ " | pane " ^ pane_to_string agent.pane;
    "Launch: " ^ launch_command_label agent;
    "Roster: " ^ roster_label agent ^ " | id " ^ agent.roster_agent;
    "Source: " ^ workspace_source_label workspace;
    "Privileges: " ^ privilege_label agent;
    "Capabilities: " ^ capability_label agent;
    connections;
  ]
  @ agent_profile agent @ agent_description agent
  @ [ rule width ]
  @ preview_lines lines agent

let no_selection_main _width =
  [ "No workspace selected"; ""; "Create or load a TA workspace state." ]

let action_line = function
  | Dashboard_edge_affordance.Action (_, label) -> "Action: " ^ label

let pipeline_main width state actor lines =
  match Dashboard_interaction.focused_edge_affordance ?actor ~lines state with
  | None -> (
      match selected_agent state with
      | None -> no_selection_main width
      | Some (workspace, agent) ->
          [
            "Pipeline";
            rule width;
            "Select an ACL edge with Right/Left to inspect actions.";
            "";
          ]
          @ selected_agent_main width lines workspace agent)
  | Some affordance ->
      let source = affordance.Dashboard_edge_affordance.source in
      let target =
        match Dashboard_interaction.selected_edge_target state with
        | None -> "none"
        | Some target ->
            Id.Agent.to_string (Dashboard_topology.node_agent target)
      in
      [
        "Pipeline edge";
        rule width;
        "Source: " ^ Id.Agent.to_string source.agent;
        "Selected target: " ^ target;
      ]
      @ List.map action_line affordance.actions

let main ?actor width lines state =
  match Dashboard_interaction.focus state with
  | Pipeline -> pipeline_main width state actor lines
  | Workspaces | Agents -> (
      match selected_agent state with
      | None -> no_selection_main width
      | Some (workspace, agent) ->
          selected_agent_main width lines workspace agent)

let footer width =
  [
    fit width
      "q quit | arrows/jk move | Tab focus | p pipeline | [ ] targets | r \
       refresh";
  ]

let clip height lines =
  if height <= 0 then []
  else
    let rec loop remaining acc = function
      | [] -> List.rev acc
      | _ when remaining = 0 -> List.rev acc
      | line :: rest -> loop (remaining - 1) (line :: acc) rest
    in
    loop height [] lines

let widths width =
  let width = max 1 width in
  let separator = " | " in
  let separator_width = String.length separator in
  let sidebar_width =
    if width < 30 then max 1 (width / 2) else clamp 18 34 (width / 3)
  in
  let separator, main_width =
    if width <= sidebar_width then ("", 0)
    else if width - sidebar_width <= separator_width then
      ("", width - sidebar_width)
    else (separator, width - sidebar_width - separator_width)
  in
  (sidebar_width, main_width, separator)

let render ?now ?(lines = 20) ?actor ?(show_footer = true) ~width ~height state
    =
  let width = max 1 width in
  let height = max 4 height in
  let footer = if show_footer then footer width else [] in
  let footer_height = List.length footer in
  let sidebar_width, main_width, separator = widths width in
  let body_height = max 1 (height - 2 - footer_height) in
  let sidebar = sidebar sidebar_width state |> clip body_height in
  let main =
    main ?actor main_width lines state
    |> List.map (fit main_width)
    |> clip body_height
  in
  {
    header = header ?now width state;
    sidebar;
    main;
    footer;
    sidebar_width;
    main_width;
    separator;
  }

let zip_body sidebar main =
  let rows = max (List.length sidebar) (List.length main) in
  let rec nth idx values =
    match (idx, values) with
    | 0, value :: _ -> Some value
    | idx, _ :: rest -> nth (idx - 1) rest
    | _, [] -> None
  in
  List.init rows (fun idx -> (nth idx sidebar, nth idx main))

let to_text layout =
  let body =
    zip_body layout.sidebar layout.main
    |> List.map (fun (left, right) ->
        let left =
          Option.value left ~default:(String.make layout.sidebar_width ' ')
        in
        let right = Option.value right ~default:"" in
        left ^ layout.separator ^ right)
  in
  String.concat "\n" (layout.header @ body @ layout.footer)
