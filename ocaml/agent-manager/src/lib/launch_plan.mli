(** Deterministic tmux launch planning for TA workspaces. *)

type agent = {
  workspace : Id.Workspace.t;
  name : Id.Agent.t;
  roster_agent : string;
  command : string list;
  cwd : string;
  env : (string * string) list;
  startup_prompt : string option;
  planned_pane : Id.Pane.t;
  tmux_target : string;
}

type workspace = {
  id : Id.Workspace.t;
  session : Tmux.session;
  root : string;
  agents : agent list;
}

type t = { workspaces : workspace list }

type selected_agent = { workspace : workspace; agent : agent }

val of_config :
  ?config_dir:string ->
  Workspace_config.t ->
  (t, Workspace_config.error list) result

val find_agent :
  t ->
  workspace:Id.Workspace.t ->
  agent:Id.Agent.t ->
  (selected_agent, string) result

val agent_count : t -> int
val describe : t -> string
