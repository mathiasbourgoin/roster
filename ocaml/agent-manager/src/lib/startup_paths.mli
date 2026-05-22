(** Default startup paths for TA workspace entrypoints.

    The resolver keeps the CLI workspace-enabled: a bare [ta] first looks for
    files in the current workspace, then falls back to the source-tree example
    used by this repository. *)

type state
type config
type 'kind candidate = private { path : string; purpose : string }

type source =
  | State of { path : string; explicit : bool }
  | Config of { path : string; explicit : bool }
  | Missing

val default_state_path : string
val default_config_path : string
val state_candidates : state candidate list
val config_candidates : config candidate list

val resolve :
  exists:(string -> bool) ->
  ?state_path:string ->
  ?config_path:string ->
  unit ->
  source

val first_config_path : exists:(string -> bool) -> string option
val describe_candidates : 'kind candidate list -> string
