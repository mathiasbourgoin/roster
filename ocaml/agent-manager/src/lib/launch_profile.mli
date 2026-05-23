(** Display labels for configured agent launch commands. *)

type kind = Codex | Claude | OpenCode | Shell | Custom of string | Unknown

type t = private {
  command : string list;
  cwd : string option;
  env : (string * string) list;
  startup_prompt : string option;
  kind : kind;
}

val of_command : string list -> t
val of_parts :
  command:string list ->
  cwd:string option ->
  env:(string * string) list ->
  startup_prompt:string option ->
  t
val profile_label : t -> string
val full_command_label : t -> string
val compact_command_label : t -> string
