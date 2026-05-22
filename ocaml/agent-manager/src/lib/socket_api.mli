(** Unix socket server and client for local TA control requests. *)

type error = Io of string | Protocol of string

val error_to_string : error -> string

val serve :
  socket_path:string ->
  state_path:string ->
  once:bool ->
  unit ->
  (unit, error) result

val request :
  socket_path:string ->
  Socket_protocol.request ->
  (Socket_protocol.response, error) result
