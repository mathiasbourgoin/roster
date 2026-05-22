(** UI-ready dashboard model for TA workspaces.

    This module keeps the future MIAOU renderer thin: it merges durable
    {!State_store} intent with observed {!Runtime_snapshot} state into a pure
    view model, then provides a deterministic text frame for CLI and QA use. *)

type runtime_state = Unknown | Unattached | Live | Missing of string
type connections = { readable : Id.Agent.t list; writable : Id.Agent.t list }

type agent = {
  workspace : Id.Workspace.t;
  name : Id.Agent.t;
  roster_agent : string;
  status : State_store.agent_status;
  pane : Id.Pane.t option;
  runtime_state : runtime_state;
  preview : string list;
  outgoing : connections;
}

type workspace = {
  id : Id.Workspace.t;
  label : string;
  root : string;
  tmux_session : Tmux.session option;
  active_view : Id.View.t;
  agents : agent list;
  link_count : int;
  live_count : int;
  blocked_count : int;
  failed_count : int;
}

type totals = {
  workspace_count : int;
  agent_count : int;
  live_count : int;
  blocked_count : int;
  failed_count : int;
}

type t = {
  captured_at : float option;
  workspaces : workspace list;
  totals : totals;
}

val of_state_runtime : State_store.t -> Runtime_snapshot.t -> t
val render : ?width:int -> t -> string
