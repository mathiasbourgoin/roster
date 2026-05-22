(** Projection from agent-roster [.harness/harness.json] to a TA workspace.

    This is the bridge that makes TA workspace-enabled before a user has
    written a TA-specific config. It derives a conservative launch config from
    the canonical harness, with Codex as the default runtime command. *)

type error = { path : string; message : string }

val default_harness_path : string
val default_output_path : string
val error_to_string : error -> string

val parse_string :
  harness_path:string ->
  output_path:string ->
  string ->
  (Workspace_config.t, error list) result

val load :
  harness_path:string -> output_path:string -> (Workspace_config.t, error list) result

val generate_file :
  harness_path:string -> output_path:string -> (string, string) result
