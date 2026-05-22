type triggered_by = Triggered_by of string
type receives = Receives of string
type produces = Produces of string
type human_gate = Human_gate of string

type t = {
  triggered_by : triggered_by;
  receives : receives;
  produces : produces;
  human_gate : human_gate;
}

let triggered_by_to_string (Triggered_by value) = value
let receives_to_string (Receives value) = value
let produces_to_string (Produces value) = value
let human_gate_to_string (Human_gate value) = value

let drop_trailing_cr line =
  let length = String.length line in
  if length > 0 && Char.equal line.[length - 1] '\r' then
    String.sub line 0 (length - 1)
  else line

let starts_with_char ch value =
  String.length value > 0 && Char.equal value.[0] ch

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

let parse_field line =
  match String.index_opt line ':' with
  | None | Some 0 -> None
  | Some idx ->
      let key = String.sub line 0 idx |> String.trim in
      let value = String.sub line (idx + 1) (String.length line - idx - 1) in
      if String.equal key "" then None else Some (key, parse_scalar value)

let frontmatter_lines content =
  match List.map drop_trailing_cr (String.split_on_char '\n' content) with
  | first :: rest when String.equal (String.trim first) "---" ->
      let rec loop acc = function
        | [] -> None
        | line :: _ when String.equal (String.trim line) "---" ->
            Some (List.rev acc)
        | line :: rest -> loop (line :: acc) rest
      in
      loop [] rest
  | _ -> None

let top_level_key line =
  if starts_with_char ' ' line || starts_with_char '\t' line then None
  else match parse_field line with Some (key, _) -> Some key | None -> None

let indented line = starts_with_char ' ' line || starts_with_char '\t' line

let pipeline_role_block lines =
  let rec take acc = function
    | [] -> List.rev acc
    | line :: rest when String.equal (String.trim line) "" -> take acc rest
    | line :: rest when indented line -> take (line :: acc) rest
    | _ -> List.rev acc
  in
  let rec loop = function
    | [] -> None
    | line :: rest -> (
        match top_level_key line with
        | Some key when String.equal key "pipeline_role" -> Some (take [] rest)
        | _ -> loop rest)
  in
  loop lines

let field key fields =
  List.fold_left
    (fun found (candidate_key, value) ->
      if String.equal candidate_key key then Some value else found)
    None fields

let nonempty = function
  | Some value when not (String.equal value "") -> Some value
  | _ -> None

let build fields =
  match
    ( nonempty (field "triggered_by" fields),
      nonempty (field "receives" fields),
      nonempty (field "produces" fields),
      nonempty (field "human_gate" fields) )
  with
  | Some triggered_by, Some receives, Some produces, Some human_gate ->
      Some
        {
          triggered_by = Triggered_by triggered_by;
          receives = Receives receives;
          produces = Produces produces;
          human_gate = Human_gate human_gate;
        }
  | _ -> None

let parse_string content =
  match frontmatter_lines content with
  | None -> None
  | Some lines -> (
      match pipeline_role_block lines with
      | None -> None
      | Some block ->
          block
          |> List.filter_map (fun line -> parse_field (String.trim line))
          |> build)
