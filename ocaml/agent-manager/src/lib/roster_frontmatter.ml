type value = Scalar of string | List of string list
type t = (string * value) list
type error = { path : string; message : string }

let max_file_bytes = 1_048_576
let error path message = { path; message }
let error_to_string { path; message } = path ^ ": " ^ message

let drop_trailing_cr line =
  let length = String.length line in
  if length > 0 && Char.equal line.[length - 1] '\r' then
    String.sub line 0 (length - 1)
  else line

let starts_with_char ch value =
  String.length value > 0 && Char.equal value.[0] ch

let ends_with_char ch value =
  let length = String.length value in
  length > 0 && Char.equal value.[length - 1] ch

let strip_edge_quote value =
  let length = String.length value in
  if length = 0 then value
  else
    let first = value.[0] in
    let value, length =
      if Char.equal first '\'' || Char.equal first '"' then
        (String.sub value 1 (length - 1), length - 1)
      else (value, length)
    in
    if length = 0 then value
    else
      let last = value.[length - 1] in
      if Char.equal last '\'' || Char.equal last '"' then
        String.sub value 0 (length - 1)
      else value

let parse_scalar raw = raw |> String.trim |> strip_edge_quote

let parse_inline_list raw =
  let trimmed = String.trim raw in
  if
    starts_with_char '[' trimmed
    && ends_with_char ']' trimmed
    && String.length trimmed >= 2
  then
    let inner = String.sub trimmed 1 (String.length trimmed - 2) in
    inner |> String.split_on_char ',' |> List.map parse_scalar
    |> List.filter (fun value -> not (String.equal value ""))
  else []

let parse_value raw =
  let trimmed = String.trim raw in
  if starts_with_char '[' trimmed && ends_with_char ']' trimmed then
    List (parse_inline_list trimmed)
  else Scalar (parse_scalar trimmed)

let parse_field line =
  match String.index_opt line ':' with
  | None | Some 0 -> None
  | Some idx ->
      let key = String.sub line 0 idx |> String.trim in
      if String.equal key "" then None
      else
        let value = String.sub line (idx + 1) (String.length line - idx - 1) in
        Some (key, parse_value value)

let parse_string content =
  match List.map drop_trailing_cr (String.split_on_char '\n' content) with
  | first :: rest when String.equal (String.trim first) "---" ->
      let rec loop acc = function
        | [] -> None
        | line :: _ when String.equal (String.trim line) "---" ->
            Some (List.rev acc)
        | line :: rest ->
            let skip =
              String.equal line "" || starts_with_char ' ' line
              || starts_with_char '\t' line
            in
            let acc =
              if skip then acc
              else
                match parse_field line with None -> acc | Some f -> f :: acc
            in
            loop acc rest
      in
      loop [] rest
  | _ -> None

let read_file path =
  match Unix.stat path with
  | exception Unix.Unix_error (code, _, _) ->
      Error (error path (Unix.error_message code))
  | stat when stat.Unix.st_kind <> Unix.S_REG ->
      Error (error path "expected regular file")
  | stat when stat.Unix.st_size > max_file_bytes ->
      Error
        (error path
           ("frontmatter file exceeds "
           ^ string_of_int max_file_bytes
           ^ " bytes"))
  | _ -> (
      match open_in_bin path with
      | exception Sys_error message -> Error (error path message)
      | channel ->
          Fun.protect
            ~finally:(fun () -> close_in_noerr channel)
            (fun () ->
              match in_channel_length channel with
              | exception Sys_error message -> Error (error path message)
              | length -> (
                  match really_input_string channel length with
                  | text -> Ok text
                  | exception Sys_error message -> Error (error path message))))

let load path =
  match read_file path with
  | Error _ as error -> error
  | Ok text -> Ok (parse_string text)

let find key fields =
  List.fold_left
    (fun found (candidate_key, value) ->
      if String.equal candidate_key key then Some value else found)
    None fields

let find_scalar key fields =
  match find key fields with Some (Scalar value) -> Some value | _ -> None

let find_list key fields =
  match find key fields with Some (List values) -> Some values | _ -> None
