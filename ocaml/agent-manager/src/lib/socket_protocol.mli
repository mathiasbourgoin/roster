(** Line-delimited JSON protocol for the local TA control socket. *)

type request = State_summary | State_show of { audit_limit : int }
type response = Success of string | Failure of string

val request_to_yojson : request -> Yojson.Safe.t
val request_of_yojson : Yojson.Safe.t -> (request, string) result
val response_to_yojson : response -> Yojson.Safe.t
val response_of_yojson : Yojson.Safe.t -> (response, string) result
val encode_request : request -> string
val decode_request : string -> (request, string) result
val encode_response : response -> string
val decode_response : string -> (response, string) result
