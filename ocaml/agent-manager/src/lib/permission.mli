(** Permission model for governed cross-agent communication. *)

type read
type write

(** A typed capability witness. The phantom parameter keeps read and write paths
    distinct where APIs need compile-time separation. *)
type _ capability = Can_read : read capability | Can_write : write capability

type t = Read | Write

val of_string : string -> (t, string) result
val to_string : t -> string
val equal : t -> t -> bool
val compare : t -> t -> int
val allows_read : t list -> bool
val allows_write : t list -> bool
