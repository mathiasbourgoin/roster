(** Filesystem persistence for TA state snapshots. *)

type error =
  | Io of { path : string; message : string }
  | Json of { path : string; message : string }
  | Snapshot of { path : string; errors : State_store.snapshot_error list }
  | Mutation of { path : string; message : string }

val save : path:string -> State_store.t -> (unit, error) result
val load : path:string -> (State_store.t, error) result

val update :
  path:string ->
  (State_store.t -> (State_store.t, string) result) ->
  (State_store.t, error) result

val error_to_string : error -> string
