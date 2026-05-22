(** Pure refresh cadence policy for dashboard runners.

    The future MIAOU runner can use this module to decide when ticks should
    trigger socket refreshes, while manual refresh keys can still bypass the
    cadence. *)

type seconds = private Seconds of float
type timestamp = private Timestamp of float
type policy
type state
type reason = Manual | Never_refreshed | Interval_elapsed | Stale
type decision = Refresh of reason | Wait of seconds

val seconds : float -> (seconds, string) result
val timestamp : float -> (timestamp, string) result
val seconds_to_float : seconds -> float
val timestamp_to_float : timestamp -> float

val policy :
  refresh_interval:seconds ->
  stale_after:seconds ->
  min_retry_interval:seconds ->
  (policy, string) result

val default_policy : policy
val init : state
val record_success : at:timestamp -> state -> state
val record_failure : at:timestamp -> state -> state
val last_success_at : state -> timestamp option
val last_attempt_at : state -> timestamp option
val failure_count : state -> int
val last_success_age : now:timestamp -> state -> seconds option
val is_stale : policy -> state -> now:timestamp -> bool
val decide : policy -> state -> now:timestamp -> manual:bool -> decision
val reason_to_string : reason -> string
val status_line : policy -> state -> now:timestamp -> string
