type key = Key of string
type key_event
type tick_event

type _ typed_event =
  | Key_event : {
      at : Dashboard_refresh_cadence.timestamp;
      key : key;
    }
      -> key_event typed_event
  | Tick_event : Dashboard_refresh_cadence.timestamp -> tick_event typed_event

type event = Event : _ typed_event -> event
type refresh_source = unit -> (Dashboard_model.t, string) result

type t = {
  interaction : Dashboard_interaction.t;
  policy : Dashboard_refresh_cadence.policy;
  cadence : Dashboard_refresh_cadence.state;
  last_refresh_reason : Dashboard_refresh_cadence.reason option;
}

type refresh_outcome =
  | No_refresh
  | Refresh_succeeded of Dashboard_refresh_cadence.reason
  | Refresh_failed of Dashboard_refresh_cadence.reason * string

type step = { state : t; outcome : refresh_outcome }

let key value = Key value
let key_to_string (Key value) = value
let key_event ~at value = Event (Key_event { at; key = key value })
let tick_event at = Event (Tick_event at)

let init ?(policy = Dashboard_refresh_cadence.default_policy) model =
  {
    interaction = Dashboard_interaction.init model;
    policy;
    cadence = Dashboard_refresh_cadence.init;
    last_refresh_reason = None;
  }

let of_interaction ?(policy = Dashboard_refresh_cadence.default_policy)
    ?refreshed_at interaction =
  let cadence =
    match refreshed_at with
    | None -> Dashboard_refresh_cadence.init
    | Some at ->
        Dashboard_refresh_cadence.record_success ~at
          Dashboard_refresh_cadence.init
  in
  {
    interaction;
    policy;
    cadence;
    last_refresh_reason = None;
  }

let with_interaction interaction state = { state with interaction }

let interaction state = state.interaction
let cadence state = state.cadence
let policy state = state.policy
let last_refresh_reason state = state.last_refresh_reason
let should_quit state = Dashboard_interaction.should_quit state.interaction
let model state = Dashboard_interaction.model state.interaction

let refresh_now ~at ~reason ~refresh state =
  match refresh () with
  | Ok model ->
      {
        state =
          {
            state with
            interaction = Dashboard_interaction.refresh model state.interaction;
            cadence = Dashboard_refresh_cadence.record_success ~at state.cadence;
            last_refresh_reason = Some reason;
          };
        outcome = Refresh_succeeded reason;
      }
  | Error message ->
      {
        state =
          {
            state with
            interaction =
              Dashboard_interaction.refresh_failed message state.interaction;
            cadence = Dashboard_refresh_cadence.record_failure ~at state.cadence;
            last_refresh_reason = Some reason;
          };
        outcome = Refresh_failed (reason, message);
      }

let maybe_refresh ~at ~manual ~refresh state =
  match
    Dashboard_refresh_cadence.decide state.policy state.cadence ~now:at ~manual
  with
  | Wait _ -> { state; outcome = No_refresh }
  | Refresh reason -> refresh_now ~at ~reason ~refresh state

let key_step ~at ~refresh state key =
  let interaction =
    Dashboard_interaction.handle_key state.interaction (key_to_string key)
  in
  let state = { state with interaction } in
  if Dashboard_interaction.should_quit interaction then
    { state; outcome = No_refresh }
  else if Dashboard_interaction.refresh_requested interaction then
    maybe_refresh ~at ~manual:true ~refresh state
  else { state; outcome = No_refresh }

let tick_step ~at ~refresh state =
  if should_quit state then { state; outcome = No_refresh }
  else maybe_refresh ~at ~manual:false ~refresh state

let step ~refresh state (Event event) =
  match event with
  | Key_event { at; key } -> key_step ~at ~refresh state key
  | Tick_event at -> tick_step ~at ~refresh state

let run ~refresh state events =
  List.fold_left
    (fun state event -> (step ~refresh state event).state)
    state events

let timestamp_now () =
  match Dashboard_refresh_cadence.timestamp (Unix.gettimeofday ()) with
  | Ok now -> now
  | Error message -> invalid_arg message

let render ?now ?width state =
  let now = Option.value now ~default:(timestamp_now ()) in
  let status =
    Dashboard_refresh_cadence.status_line state.policy state.cadence ~now
  in
  let reason =
    match state.last_refresh_reason with
    | None -> []
    | Some reason ->
        [
          "Last refresh reason: "
          ^ Dashboard_refresh_cadence.reason_to_string reason;
        ]
  in
  let now_float = Dashboard_refresh_cadence.timestamp_to_float now in
  String.concat "\n"
    ((status :: reason)
    @ [ Dashboard_interaction.render ~now:now_float ?width state.interaction ])
