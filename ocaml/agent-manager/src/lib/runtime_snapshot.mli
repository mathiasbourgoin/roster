(** Cacheable observations of live tmux runtime state.

    Runtime snapshots are deliberately separate from {!State_store}: state
    records roster intent and audited mutations, while this module records what
    tmux currently reports for panes attached in that state. *)

type pane_state = Unattached | Live | Missing of string

type agent = {
  workspace : Id.Workspace.t;
  name : Id.Agent.t;
  roster_agent : string;
  configured_status : State_store.agent_status;
  expected_session : Tmux.session option;
  pane : Id.Pane.t option;
  pane_identity : Tmux.pane_identity option;
  pane_state : pane_state;
  preview : string list;
}

type workspace = { id : Id.Workspace.t; agents : agent list }
type t = { captured_at : float; workspaces : workspace list }

val max_preview_lines : int
val max_preview_line_bytes : int
val max_preview_bytes : int

val collect :
  ?now:float ->
  ?lines:int ->
  ?runner:(Tmux.command -> (string, Tmux.error) result) ->
  State_store.t ->
  t

val collect_agent :
  ?now:float ->
  ?lines:int ->
  ?runner:(Tmux.command -> (string, Tmux.error) result) ->
  State_store.t ->
  workspace:Id.Workspace.t ->
  agent:Id.Agent.t ->
  (t, string) result

val to_yojson : t -> Yojson.Safe.t
val summarize : t -> string
