(** Execute supervised tmux launch plans. *)

type error =
  | Empty_workspace of Id.Workspace.t
  | Duplicate_session of Tmux.session
  | Session_exists of Tmux.session
  | Invalid_pane_id of {
      target : Tmux.target;
      output : string;
      message : string;
    }
  | Tmux of Tmux.error

type attachment = {
  workspace : Id.Workspace.t;
  agent : Id.Agent.t;
  planned_pane : Id.Pane.t;
  pane : Id.Pane.t;
  target : Tmux.target;
}

type runner = Tmux.command -> (string, Tmux.error) result

val commands : Launch_plan.t -> (Tmux.command list, error) result
val command_lines : Launch_plan.t -> (string list, error) result
val dry_run_lines : Launch_plan.t -> (string list, error) result
val run_with : runner -> Launch_plan.t -> (attachment list, error) result
val run : Launch_plan.t -> (attachment list, error) result
val cleanup_plan : Launch_plan.t -> unit
val error_to_string : error -> string
