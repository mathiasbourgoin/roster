(** Typed reader for an agent frontmatter [pipeline_role] block. *)

type triggered_by = private Triggered_by of string
type receives = private Receives of string
type produces = private Produces of string
type human_gate = private Human_gate of string

type t = {
  triggered_by : triggered_by;
  receives : receives;
  produces : produces;
  human_gate : human_gate;
}

val parse_string : string -> t option
val triggered_by_to_string : triggered_by -> string
val receives_to_string : receives -> string
val produces_to_string : produces -> string
val human_gate_to_string : human_gate -> string
