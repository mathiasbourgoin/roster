(** Shallow reader for agent markdown frontmatter.

    This mirrors the TypeScript indexer: only a leading [---] block is read,
    only flat [key: value] lines are parsed, inline arrays are supported, and
    indented YAML is ignored. *)

type value = Scalar of string | List of string list
type t
type error = { path : string; message : string }

val max_file_bytes : int
val parse_string : string -> t option
val load : string -> (t option, error) result
val find_scalar : string -> t -> string option
val find_list : string -> t -> string list option
val error_to_string : error -> string
