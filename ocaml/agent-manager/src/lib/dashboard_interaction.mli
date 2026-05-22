(** Keyboard-focused dashboard state.

    The shape mirrors the state/update/view boundary used by MIAOU pages while
    keeping this package free of a hard MIAOU dependency until the runner is
    available in the local switch. *)

type focus = Workspaces | Agents
type t

val init : Dashboard_model.t -> t
val model : t -> Dashboard_model.t
val focus : t -> focus
val selected_workspace : t -> Id.Workspace.t option
val selected_agent : t -> Id.Agent.t option
val refresh_requested : t -> bool
val should_quit : t -> bool

val select :
  ?workspace:Id.Workspace.t -> ?agent:Id.Agent.t -> t -> (t, string) result

val refresh : Dashboard_model.t -> t -> t
val handle_key : t -> string -> t
val render : ?width:int -> t -> string
