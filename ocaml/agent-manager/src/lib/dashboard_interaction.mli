(** Keyboard-focused dashboard state.

    The shape mirrors the state/update/view boundary used by MIAOU pages while
    keeping this package free of a hard MIAOU dependency until the runner is
    available in the local switch. *)

type focus = Workspaces | Agents | Pipeline
type refresh_status = Fresh | Refreshing | Stale of string
type t

val init : Dashboard_model.t -> t
val model : t -> Dashboard_model.t
val focus : t -> focus
val selected_workspace : t -> Id.Workspace.t option
val selected_agent : t -> Id.Agent.t option
val selected_edge : t -> Dashboard_topology.edge_id option
val selected_edge_target : t -> Dashboard_topology.node_id option

val focused_edge_affordance :
  ?actor:Id.Agent.t -> ?lines:int -> t -> Dashboard_edge_affordance.t option

val refresh_requested : t -> bool
val refresh_status : t -> refresh_status
val should_quit : t -> bool

val select :
  ?workspace:Id.Workspace.t -> ?agent:Id.Agent.t -> t -> (t, string) result

val refresh : Dashboard_model.t -> t -> t
val refresh_failed : string -> t -> t
val handle_key : t -> string -> t

val render :
  ?now:float ->
  ?width:int ->
  ?height:Dashboard_viewport.height ->
  ?lines:int ->
  ?actor:Id.Agent.t ->
  t ->
  string
