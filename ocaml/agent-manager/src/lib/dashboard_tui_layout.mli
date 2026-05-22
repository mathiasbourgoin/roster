(** Full-screen dashboard layout model for terminal TUI renderers.

    This module turns dashboard interaction state into stable, bounded text
    regions. Terminal drivers can add colour and alternate-screen mechanics
    without knowing how to choose dashboard content. *)

type section = string list

type t = {
  header : section;
  sidebar : section;
  main : section;
  footer : section;
  sidebar_width : int;
  main_width : int;
  separator : string;
}

val render :
  ?now:float ->
  ?lines:int ->
  ?actor:Id.Agent.t ->
  ?show_footer:bool ->
  width:int ->
  height:int ->
  Dashboard_interaction.t ->
  t

val to_text : t -> string
