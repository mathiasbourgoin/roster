(** Pure dashboard runner boundary for the future MIAOU TUI.

    This module keeps the event/update/render loop independent from terminal
    drivers. A concrete MIAOU page can feed typed key and tick events into this
    runner, while tests can use deterministic refresh sources. *)

type key = private Key of string
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
type t

type refresh_outcome =
  | No_refresh
  | Refresh_succeeded of Dashboard_refresh_cadence.reason
  | Refresh_failed of Dashboard_refresh_cadence.reason * string

type step = { state : t; outcome : refresh_outcome }

val key : string -> key
val key_to_string : key -> string
val key_event : at:Dashboard_refresh_cadence.timestamp -> string -> event
val tick_event : Dashboard_refresh_cadence.timestamp -> event
val init : ?policy:Dashboard_refresh_cadence.policy -> Dashboard_model.t -> t

val of_interaction :
  ?policy:Dashboard_refresh_cadence.policy ->
  ?refreshed_at:Dashboard_refresh_cadence.timestamp ->
  Dashboard_interaction.t ->
  t

val with_interaction : Dashboard_interaction.t -> t -> t

val interaction : t -> Dashboard_interaction.t
val cadence : t -> Dashboard_refresh_cadence.state
val policy : t -> Dashboard_refresh_cadence.policy
val last_refresh_reason : t -> Dashboard_refresh_cadence.reason option
val should_quit : t -> bool
val model : t -> Dashboard_model.t
val step : refresh:refresh_source -> t -> event -> step
val run : refresh:refresh_source -> t -> event list -> t

val render :
  ?now:Dashboard_refresh_cadence.timestamp -> ?width:int -> t -> string
