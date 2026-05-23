(** Pure state transitions for launch runtime metadata. *)

val preflight : State_store.t -> Launch_plan.t -> (unit, string) result

val preflight_agent :
  State_store.t -> Launch_plan.selected_agent -> (unit, string) result

val apply_attachments :
  ?actor:Id.Agent.t ->
  State_store.t ->
  Launch_runtime.attachment list ->
  (State_store.t, string) result
