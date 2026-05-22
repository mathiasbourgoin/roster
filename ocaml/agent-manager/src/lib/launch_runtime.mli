(** Execute supervised tmux launch plans. *)

type error =
  | Empty_workspace of Id.Workspace.t
  | Duplicate_session of Tmux.session
  | Session_exists of Tmux.session
  | Tmux of Tmux.error

val commands : Launch_plan.t -> (Tmux.command list, error) result
val command_lines : Launch_plan.t -> (string list, error) result
val run : Launch_plan.t -> (unit, error) result
val error_to_string : error -> string
