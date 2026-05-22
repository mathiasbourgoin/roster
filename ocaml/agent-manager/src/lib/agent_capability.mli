(** Explicit TA capabilities granted to selected roster agents.

    These are product capabilities, not socket ACLs. Read/write ACLs govern
    communication between existing sessions; capabilities govern who may create
    or connect agents in future TUI flows. *)

type create_agent
type connect_agents

type _ witness =
  | Can_create_agent : create_agent witness
  | Can_connect_agents : connect_agents witness

type t = Create_agent | Connect_agents

val of_string : string -> (t, string) result
val to_string : t -> string
val equal : t -> t -> bool
val compare : t -> t -> int
val grants_create_agent : t list -> bool
val grants_connect_agents : t list -> bool
