(** Pure state transitions for launch runtime metadata. *)

val preflight : State_store.t -> Launch_plan.t -> (unit, string) result

val apply_attachments :
  State_store.t ->
  Launch_runtime.attachment list ->
  (State_store.t, string) result
