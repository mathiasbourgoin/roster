(** Socket-friendly dashboard refresh payloads.

    A dashboard snapshot contains only the durable state and runtime pane
    previews the requesting actor is allowed to read. *)

type t = { state : State_store.t; runtime : Runtime_snapshot.t }

val of_state_for_actor :
  ?now:float ->
  ?lines:int ->
  ?runner:(Tmux.command -> (string, Tmux.error) result) ->
  State_store.t ->
  actor:Id.Agent.t ->
  (t, string) result

val to_yojson : t -> Yojson.Safe.t

val to_bounded_yojson_string :
  max_bytes:int ->
  encoded_length:(string -> int) ->
  t ->
  (string, string) result

val of_yojson : Yojson.Safe.t -> (t, string) result
val to_dashboard_model : t -> Dashboard_model.t
