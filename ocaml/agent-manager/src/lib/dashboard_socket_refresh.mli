(** Socket-backed dashboard refresh source.

    This module is the small effectful boundary the future MIAOU runner can call
    when the dashboard requests a refresh. *)

type error =
  | Socket of Socket_api.error
  | Failure of string
  | Invalid_json of string
  | Snapshot_decode of string

val error_to_string : error -> string

val fetch_snapshot :
  ?request_socket:
    (socket_path:string ->
    Socket_protocol.request ->
    (Socket_protocol.response, Socket_api.error) result) ->
  socket_path:string ->
  actor:Id.Agent.t ->
  lines:int ->
  unit ->
  (Dashboard_snapshot.t, error) result

val fetch_model :
  ?request_socket:
    (socket_path:string ->
    Socket_protocol.request ->
    (Socket_protocol.response, Socket_api.error) result) ->
  socket_path:string ->
  actor:Id.Agent.t ->
  lines:int ->
  unit ->
  (Dashboard_model.t, error) result
