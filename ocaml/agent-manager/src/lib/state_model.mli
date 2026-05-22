(** Shared runtime state types for TA.

    State operations live in {!State_store}; snapshot encoding lives in
    {!State_snapshot}. Keeping the records here avoids circular dependencies
    while preserving one typed state shape. *)

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
  pane_identity : Tmux.pane_identity option;
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
  tmux_session : Tmux.session option;
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

type t = {
  workspaces : workspace list;
  audit_events : audit_event list;
  next_seq : int;
}

val status_to_string : agent_status -> string
