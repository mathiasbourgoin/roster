(** Small tmux adapter.

    This module is intentionally narrow. Higher layers must not construct raw
    tmux command lines directly, which keeps ACL and audit enforcement above the
    process boundary testable. *)

type session = private string
type target = private string

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
  | New_detached_session_with_pane_id of {
      session : session;
      cwd : string option;
      command : string list;
    }
  | Split_window of {
      target : target;
      cwd : string option;
      command : string list;
    }
  | Split_window_with_pane_id of {
      target : target;
      cwd : string option;
      command : string list;
    }
  | Select_layout of { target : target; layout : string }
  | Send_keys of { target : session; text : string }
  | Send_keys_literal of { target : target; text : string }
  | Send_keys_to of { target : target; text : string }
  | Capture_pane of { target : session; lines : int }
  | Display_pane_id of target
  | Kill_session of session

val session_of_string : string -> (session, string) result
val unsafe_session_of_string : string -> session
val session_to_string : session -> string
val equal_session : session -> session -> bool
val compare_session : session -> session -> int
val target_of_string : string -> (target, string) result
val unsafe_target_of_string : string -> target
val target_to_string : target -> string
val argv : command -> string list
val command_line : command -> string
val run : command -> (string, error) result
val smoke : ?session:session -> unit -> (string, error) result
val error_to_string : error -> string
