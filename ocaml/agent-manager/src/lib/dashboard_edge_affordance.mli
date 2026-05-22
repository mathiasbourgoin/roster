(** Pure action affordances for a focused dashboard pipeline edge.

    This module describes what a future TUI can safely offer for a selected
    declared ACL edge without exposing raw tmux commands or mutating socket
    protocol state. *)

type read
type write
type runtime_state = Unknown | Unattached | Live | Missing of string

type endpoint = {
  workspace : Id.Workspace.t;
  agent : Id.Agent.t;
  tmux_session : Tmux.session option;
  pane : Id.Pane.t option;
  state : runtime_state;
  preview_lines : int;
}

type target = { endpoint : endpoint; readable : bool; writable : bool }

type _ socket_intent =
  | Runtime_snapshot : {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      lines : int;
    }
      -> read socket_intent
  | Future_agent_message : {
      workspace : Id.Workspace.t;
      from_agent : Id.Agent.t;
      to_agent : Id.Agent.t;
    }
      -> write socket_intent
  | Focus_pane : {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      pane : Id.Pane.t option;
    }
      -> read socket_intent

type action = Action : 'cap socket_intent * string -> action

type t = {
  edge : Dashboard_topology.edge_id;
  source : endpoint;
  targets : target list;
  actions : action list;
}

val endpoint_ref : endpoint -> string
val socket_intent_to_string : 'cap socket_intent -> string
val action_to_string : action -> string

val render_preview :
  ?selected_target:Id.Agent.t -> width:int -> t -> string list
