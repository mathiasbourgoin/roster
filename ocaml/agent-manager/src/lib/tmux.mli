(** Small tmux adapter.

    This module is intentionally narrow. Higher layers must not construct raw
    tmux command lines directly, which keeps ACL and audit enforcement above the
    process boundary testable. *)

type session = private string

type error = {
  argv : string list;
  status : Unix.process_status;
  output : string;
}

type command =
  | Has_session of session
  | New_detached_session of {
      session : session;
      cwd : string option;
      command : string list;
    }
  | Send_keys of { target : session; text : string }
  | Capture_pane of { target : session; lines : int }
  | Kill_session of session

val session_of_string : string -> (session, string) result
val unsafe_session_of_string : string -> session
val session_to_string : session -> string
val argv : command -> string list
val run : command -> (string, error) result
val smoke : ?session:session -> unit -> (string, error) result
val error_to_string : error -> string
