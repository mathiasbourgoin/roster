(** Strong identifiers used by TA domain objects.

    These modules deliberately avoid plain strings at public boundaries. IDs
    must be non-empty and contain only ASCII letters, digits, [_], [-], or [.].
    Pane IDs additionally accept [%] for native tmux pane ids such as [%77]. *)

module type S = sig
  type t = private string

  val of_string : string -> (t, string) result
  val unsafe_of_string : string -> t
  val to_string : t -> string
  val equal : t -> t -> bool
  val compare : t -> t -> int
end

module Workspace : S
module Agent : S
module View : S
module Pane : S
