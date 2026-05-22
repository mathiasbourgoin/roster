(** Terminal viewport bounds for dashboard frames.

    This module is deliberately renderer-neutral. MIAOU pages and CLI renderers
    can share the same height clipping contract without knowing about dashboard
    model internals. *)

type height = private Height of int

val height : int -> (height, string) result
val height_to_int : height -> int
val clip : ?height:height -> string -> string
