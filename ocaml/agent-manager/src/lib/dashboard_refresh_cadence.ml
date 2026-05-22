type seconds = Seconds of float
type timestamp = Timestamp of float

type policy = {
  refresh_interval : seconds;
  stale_after : seconds;
  min_retry_interval : seconds;
}

type state = {
  last_success_at : timestamp option;
  last_attempt_at : timestamp option;
  failure_count : int;
}

type reason = Manual | Never_refreshed | Interval_elapsed | Stale
type decision = Refresh of reason | Wait of seconds

let finite_non_negative label value =
  match classify_float value with
  | FP_nan | FP_infinite -> Error (label ^ " must be finite")
  | _ when value < 0.0 -> Error (label ^ " must be non-negative")
  | _ -> Ok value

let seconds value =
  match finite_non_negative "seconds" value with
  | Ok value -> Ok (Seconds value)
  | Error _ as error -> error

let timestamp value =
  match finite_non_negative "timestamp" value with
  | Ok value -> Ok (Timestamp value)
  | Error _ as error -> error

let seconds_to_float (Seconds value) = value
let timestamp_to_float (Timestamp value) = value

let policy ~refresh_interval ~stale_after ~min_retry_interval =
  let refresh_interval_value = seconds_to_float refresh_interval in
  let stale_after_value = seconds_to_float stale_after in
  if refresh_interval_value <= 0.0 then
    Error "refresh_interval must be positive"
  else if stale_after_value <= 0.0 then Error "stale_after must be positive"
  else if stale_after_value < refresh_interval_value then
    Error "stale_after must be greater than or equal to refresh_interval"
  else Ok { refresh_interval; stale_after; min_retry_interval }

let unsafe_seconds value =
  match seconds value with
  | Ok value -> value
  | Error message -> invalid_arg message

let default_policy =
  match
    policy ~refresh_interval:(unsafe_seconds 2.0)
      ~stale_after:(unsafe_seconds 10.0)
      ~min_retry_interval:(unsafe_seconds 0.5)
  with
  | Ok policy -> policy
  | Error message -> invalid_arg message

let init = { last_success_at = None; last_attempt_at = None; failure_count = 0 }

let record_success ~at _state =
  { last_success_at = Some at; last_attempt_at = Some at; failure_count = 0 }

let record_failure ~at state =
  {
    state with
    last_attempt_at = Some at;
    failure_count = state.failure_count + 1;
  }

let last_success_at state = state.last_success_at
let last_attempt_at state = state.last_attempt_at
let failure_count state = state.failure_count

let elapsed ~now at =
  let now = timestamp_to_float now in
  let at = timestamp_to_float at in
  Seconds (max 0.0 (now -. at))

let last_success_age ~now state =
  Option.map (elapsed ~now) state.last_success_at

let seconds_gte left right = seconds_to_float left >= seconds_to_float right

let seconds_subtract left right =
  Seconds (max 0.0 (seconds_to_float left -. seconds_to_float right))

let is_stale policy state ~now =
  match last_success_age ~now state with
  | None -> true
  | Some age -> seconds_gte age policy.stale_after

let retry_wait policy state ~now =
  match state.last_attempt_at with
  | None -> None
  | Some last_attempt ->
      let age = elapsed ~now last_attempt in
      if seconds_gte age policy.min_retry_interval then None
      else Some (seconds_subtract policy.min_retry_interval age)

let decide policy state ~now ~manual =
  if manual then Refresh Manual
  else
    match retry_wait policy state ~now with
    | Some wait -> Wait wait
    | None -> (
        match last_success_age ~now state with
        | None -> Refresh Never_refreshed
        | Some age when seconds_gte age policy.stale_after -> Refresh Stale
        | Some age when seconds_gte age policy.refresh_interval ->
            Refresh Interval_elapsed
        | Some age -> Wait (seconds_subtract policy.refresh_interval age))

let reason_to_string = function
  | Manual -> "manual"
  | Never_refreshed -> "never-refreshed"
  | Interval_elapsed -> "interval-elapsed"
  | Stale -> "stale"

let seconds_label seconds = Printf.sprintf "%.1fs" (seconds_to_float seconds)

let status_line policy state ~now =
  let freshness =
    match last_success_age ~now state with
    | None -> "never refreshed"
    | Some age when seconds_gte age policy.stale_after ->
        "stale, last success " ^ seconds_label age ^ " ago"
    | Some age -> "fresh, last success " ^ seconds_label age ^ " ago"
  in
  if state.failure_count = 0 then "Refresh cadence: " ^ freshness
  else
    Printf.sprintf "Refresh cadence: %s, failures %d" freshness
      state.failure_count
