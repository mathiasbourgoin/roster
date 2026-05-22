(** Unix socket server and client for local TA control requests. *)

type error = Io of string | Protocol of string

val error_to_string : error -> string

type launch_config

val launch_config :
  config_path:string -> ?roster_index:string -> unit -> launch_config

val start_agent :
  state_path:string ->
  launch_config:launch_config ->
  workspace:Id.Workspace.t ->
  agent:Id.Agent.t ->
  actor:Id.Agent.t ->
  unit ->
  Socket_protocol.response

val serve :
  ?launch_config:launch_config ->
  ?start_actor:Id.Agent.t ->
  socket_path:string ->
  state_path:string ->
  once:bool ->
  unit ->
  (unit, error) result

val request :
  socket_path:string ->
  Socket_protocol.request ->
  (Socket_protocol.response, error) result
