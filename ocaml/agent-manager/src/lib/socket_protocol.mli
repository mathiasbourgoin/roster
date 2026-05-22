(** Line-delimited JSON protocol for the local TA control socket. *)

type request =
  | State_summary
  | State_show of { audit_limit : int }
  | Runtime_snapshot of {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      actor : Id.Agent.t;
      lines : int;
    }
  | Dashboard_snapshot of { actor : Id.Agent.t; lines : int }
  | Set_status of {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      status : State_store.agent_status;
      actor : Id.Agent.t option;
    }
  | Attach_pane of {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      pane : Id.Pane.t;
      actor : Id.Agent.t option;
    }
  | Launch_dry_run of { config_path : string; roster_index : string option }
  | Launch_start of {
      config_path : string;
      roster_index : string option;
      actor : Id.Agent.t;
    }

type response = Success of string | Failure of string

val request_to_yojson : request -> Yojson.Safe.t
val request_of_yojson : Yojson.Safe.t -> (request, string) result
val response_to_yojson : response -> Yojson.Safe.t
val response_of_yojson : Yojson.Safe.t -> (response, string) result
val encode_request : request -> string
val decode_request : string -> (request, string) result
val encode_response : response -> string
val decode_response : string -> (response, string) result
