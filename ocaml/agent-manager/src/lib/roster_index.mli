(** Minimal reader for agent-roster's generated [index.json]. *)

type entry = {
  name : string;
  display_name : string option;
  description : string option;
  domain : string list;
  tags : string list;
  path : string option;
  source : string option;
}

type t
type error = { path : string; message : string }

val empty : t
val parse_string : string -> (t, error list) result
val load : string -> (t, error list) result
val mem_agent : t -> string -> bool
val find_agent : t -> string -> entry option
val agents : t -> entry list
val error_to_string : error -> string
