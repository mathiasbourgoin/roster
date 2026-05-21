module type S = sig
  type t = private string

  val of_string : string -> (t, string) result
  val unsafe_of_string : string -> t
  val to_string : t -> string
  val equal : t -> t -> bool
  val compare : t -> t -> int
end

module Make (Name : sig
  val label : string
end) : S = struct
  type t = string

  let is_allowed = function
    | 'a' .. 'z' | 'A' .. 'Z' | '0' .. '9' | '_' | '-' | '.' -> true
    | _ -> false

  let rec all_allowed s idx =
    if idx = String.length s then true
    else if is_allowed s.[idx] then all_allowed s (idx + 1)
    else false

  let of_string value =
    if String.length value = 0 then Error (Name.label ^ " id must not be empty")
    else if all_allowed value 0 then Ok value
    else
      Error
        (Name.label ^ " id may contain only letters, digits, '.', '_', and '-'")

  let unsafe_of_string value =
    match of_string value with
    | Ok id -> id
    | Error message -> invalid_arg message

  let to_string value = value
  let equal = String.equal
  let compare = String.compare
end

module Workspace = Make (struct
  let label = "workspace"
end)

module Agent = Make (struct
  let label = "agent"
end)

module View = Make (struct
  let label = "view"
end)

module Pane = Make (struct
  let label = "pane"
end)
