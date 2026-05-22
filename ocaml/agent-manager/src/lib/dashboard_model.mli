(** UI-ready dashboard model for TA workspaces.

    This module keeps the future MIAOU renderer thin: it merges durable
    {!State_store} intent with observed {!Runtime_snapshot} state into a pure
    view model, then provides a deterministic text frame for CLI and QA use. *)

type runtime_state = Unknown | Unattached | Live | Missing of string
type connections = { readable : Id.Agent.t list; writable : Id.Agent.t list }

type roster_metadata = {
  display_name : string option;
  description : string option;
  domain : string list;
  tags : string list;
  model : string option;
  complexity : string option;
  compatible_with : string list;
  version : string option;
  author : string option;
  isolation : string option;
  source : string option;
}

type agent = {
  workspace : Id.Workspace.t;
  name : Id.Agent.t;
  roster_agent : string;
  roster_metadata : roster_metadata option;
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

type selection = {
  workspace : Id.Workspace.t option;
  agent : Id.Agent.t option;
}

val of_state_runtime : State_store.t -> Runtime_snapshot.t -> t
val enrich_with_roster : Roster_index.t -> t -> t
val render : ?width:int -> ?selection:selection -> t -> string
