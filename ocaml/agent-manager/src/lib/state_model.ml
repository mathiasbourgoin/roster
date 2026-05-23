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
  command : string list;
  cwd : string option;
  env : (string * string) list;
  startup_prompt : string option;
  status : agent_status;
  pane : Id.Pane.t option;
  pane_identity : Tmux.pane_identity option;
  capabilities : Agent_capability.t list;
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
  harness_path : string option;
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

let status_to_string = function
  | Not_started -> "not-started"
  | Starting -> "starting"
  | Running -> "running"
  | Idle -> "idle"
  | Blocked reason -> "blocked: " ^ reason
  | Done -> "done"
  | Failed reason -> "failed: " ^ reason
