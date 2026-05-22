(** Typed in-memory runtime state for TA workspaces.

    This module is deliberately pure: callers receive a new store after each
    state transition. The future daemon can persist snapshots or replay audit
    events without changing the public state model. *)

type agent_status =
  | Not_started
  | Starting
  | Running
  | Idle
  | Blocked of string
  | Done
  | Failed of string

type agent = {
  name : Id.Agent.t;
  roster_agent : string;
  status : agent_status;
  pane : Id.Pane.t option;
}

type link = {
  from_agent : Id.Agent.t;
  to_agent : Id.Agent.t;
  permissions : Permission.t list;
  reason : string;
}

type workspace = {
  id : Id.Workspace.t;
  label : string;
  root : string;
  active_view : Id.View.t;
  agents : agent list;
  links : link list;
}

type audit_kind =
  | Workspace_loaded
  | Agent_status_changed of {
      agent : Id.Agent.t;
      before : agent_status;
      after : agent_status;
    }
  | Pane_attached of { agent : Id.Agent.t; pane : Id.Pane.t }

type audit_event = {
  seq : int;
  workspace : Id.Workspace.t;
  actor : Id.Agent.t option;
  kind : audit_kind;
}

type t
type snapshot_error = { path : string; message : string }

val of_config : Workspace_config.t -> (t, Workspace_config.error list) result
val workspaces : t -> workspace list
val audit_events : t -> audit_event list
val summarize : t -> string
val to_yojson : t -> Yojson.Safe.t
val of_yojson : Yojson.Safe.t -> (t, snapshot_error list) result
val snapshot_error_to_string : snapshot_error -> string
val find_workspace : t -> Id.Workspace.t -> (workspace, string) result
val find_agent : workspace -> Id.Agent.t -> (agent, string) result

val can_access :
  t ->
  workspace:Id.Workspace.t ->
  from_agent:Id.Agent.t ->
  to_agent:Id.Agent.t ->
  Permission.t ->
  bool

val set_agent_status :
  t ->
  workspace:Id.Workspace.t ->
  agent:Id.Agent.t ->
  status:agent_status ->
  actor:Id.Agent.t option ->
  (t, string) result

val attach_pane :
  t ->
  workspace:Id.Workspace.t ->
  agent:Id.Agent.t ->
  pane:Id.Pane.t ->
  actor:Id.Agent.t option ->
  (t, string) result

val status_to_string : agent_status -> string
