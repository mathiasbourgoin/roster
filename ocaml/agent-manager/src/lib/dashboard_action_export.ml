type export = {
  version : string;
  focus : Dashboard_interaction.focus;
  refresh_status : Dashboard_interaction.refresh_status;
  selected_edge : Dashboard_topology.edge_id option;
  selected_target : Dashboard_topology.node_id option;
  affordance : Dashboard_edge_affordance.t option;
}

let version = "0.1.0"

let focus_to_string = function
  | Dashboard_interaction.Workspaces -> "workspaces"
  | Agents -> "agents"
  | Pipeline -> "pipeline"

let refresh_status_to_yojson = function
  | Dashboard_interaction.Fresh -> `Assoc [ ("kind", `String "fresh") ]
  | Refreshing -> `Assoc [ ("kind", `String "refreshing") ]
  | Stale message ->
      `Assoc [ ("kind", `String "stale"); ("message", `String message) ]

let edge_id_to_yojson edge =
  `Assoc
    [
      ( "workspace",
        `String
          (Id.Workspace.to_string (Dashboard_topology.edge_workspace edge)) );
      ( "from_agent",
        `String (Id.Agent.to_string (Dashboard_topology.edge_from_agent edge))
      );
    ]

let node_id_to_yojson node =
  `Assoc
    [
      ( "workspace",
        `String
          (Id.Workspace.to_string (Dashboard_topology.node_workspace node)) );
      ( "agent",
        `String (Id.Agent.to_string (Dashboard_topology.node_agent node)) );
    ]

let option_to_yojson encode = function
  | None -> `Null
  | Some value -> encode value

let selected_target_agent selected_target =
  Option.map Dashboard_topology.node_agent selected_target

let of_interaction ?actor ?lines interaction =
  {
    version;
    focus = Dashboard_interaction.focus interaction;
    refresh_status = Dashboard_interaction.refresh_status interaction;
    selected_edge = Dashboard_interaction.selected_edge interaction;
    selected_target = Dashboard_interaction.selected_edge_target interaction;
    affordance =
      Dashboard_interaction.focused_edge_affordance ?actor ?lines interaction;
  }

let to_yojson export =
  let selected_target = selected_target_agent export.selected_target in
  `Assoc
    [
      ("version", `String export.version);
      ("focus", `String (focus_to_string export.focus));
      ("refresh_status", refresh_status_to_yojson export.refresh_status);
      ("selected_edge", option_to_yojson edge_id_to_yojson export.selected_edge);
      ( "selected_target",
        option_to_yojson node_id_to_yojson export.selected_target );
      ( "affordance",
        option_to_yojson
          (Dashboard_edge_affordance.to_yojson ?selected_target)
          export.affordance );
    ]

let to_string export = export |> to_yojson |> Yojson.Safe.pretty_to_string
