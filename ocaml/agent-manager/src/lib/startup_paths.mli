(** Default startup paths for TA workspace entrypoints.

    The resolver keeps the CLI workspace-enabled: a bare [ta] first looks for
    TA state/config files in the current workspace, then derives a TA config
    from the canonical agent-roster harness before falling back to examples. *)

type state
type config
type harness
type 'kind candidate = private { path : string; purpose : string }

type source =
  | State of { path : string; explicit : bool }
  | Config of { path : string; explicit : bool }
  | Harness of { path : string; output_path : string }
  | Missing

val default_state_path : string
val default_config_path : string
val default_harness_path : string
val default_harness_output_path : string
val state_candidates : state candidate list
val config_candidates : config candidate list
val harness_candidates : harness candidate list

val resolve :
  exists:(string -> bool) ->
  ?state_path:string ->
  ?config_path:string ->
  unit ->
  source

val first_config_path : exists:(string -> bool) -> string option
val describe_candidates : 'kind candidate list -> string
