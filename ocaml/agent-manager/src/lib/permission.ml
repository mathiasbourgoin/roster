type read
type write
type _ capability = Can_read : read capability | Can_write : write capability
type t = Read | Write

let of_string = function
  | "read" -> Ok Read
  | "write" -> Ok Write
  | value -> Error ("unknown permission: " ^ value)

let to_string = function Read -> "read" | Write -> "write"

let equal left right =
  match (left, right) with
  | Read, Read | Write, Write -> true
  | Read, Write | Write, Read -> false

let compare left right =
  match (left, right) with
  | Read, Read | Write, Write -> 0
  | Read, Write -> -1
  | Write, Read -> 1

let allows_read permissions = List.exists (equal Read) permissions
let allows_write permissions = List.exists (equal Write) permissions
