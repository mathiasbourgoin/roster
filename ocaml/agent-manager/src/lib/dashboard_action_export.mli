(** Structured, read-only export of focused dashboard edge actions.

    The schema is intentionally small and stable for future TUI, MCP, and test
    consumers. It mirrors the selected dashboard interaction after key replay
    without executing tmux commands or sending inter-agent messages.

    Schema version [0.1.0]:

    - [focus] is [workspaces], [agents], or [pipeline].
    - [refresh_status] is an object with kind [fresh], [refreshing], or [stale].
    - [selected_edge] is [null] or an object with [workspace] and [from_agent].
    - [selected_target] is [null] or an object with [workspace] and [agent].
    - [affordance] is [null] unless a pipeline edge is focused. When present, it
      contains source and target endpoint metadata plus typed action intents. *)

type export = {
  version : string;
  focus : Dashboard_interaction.focus;
  refresh_status : Dashboard_interaction.refresh_status;
  selected_edge : Dashboard_topology.edge_id option;
  selected_target : Dashboard_topology.node_id option;
  affordance : Dashboard_edge_affordance.t option;
}

val of_interaction :
  ?actor:Id.Agent.t -> ?lines:int -> Dashboard_interaction.t -> export

val focus_to_string : Dashboard_interaction.focus -> string

val refresh_status_to_yojson :
  Dashboard_interaction.refresh_status -> Yojson.Safe.t

val to_yojson : export -> Yojson.Safe.t
val to_string : export -> string
