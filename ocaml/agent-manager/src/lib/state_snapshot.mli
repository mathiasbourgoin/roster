(** JSON snapshots for {!State_model.t}. *)

type error = { path : string; message : string }

val to_yojson : State_model.t -> Yojson.Safe.t
val of_yojson : Yojson.Safe.t -> (State_model.t, error list) result
val error_to_string : error -> string
