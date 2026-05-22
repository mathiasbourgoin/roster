type height = Height of int

let height value =
  if value < 1 then Error "height must be positive" else Ok (Height value)

let height_to_int (Height value) = value

let split_lines value =
  let length = String.length value in
  let rec loop start idx acc =
    if idx = length then
      let acc =
        if start = idx then acc else String.sub value start (idx - start) :: acc
      in
      List.rev acc
    else if Char.equal value.[idx] '\n' then
      let line = String.sub value start (idx - start) in
      loop (idx + 1) (idx + 1) (line :: acc)
    else loop start (idx + 1) acc
  in
  loop 0 0 []

let fit width value =
  let length = String.length value in
  if width <= 0 then ""
  else if length = width then value
  else if length < width then value ^ String.make (width - length) ' '
  else if width <= 3 then String.sub value 0 width
  else String.sub value 0 (width - 3) ^ "..."

let frame_width lines =
  List.fold_left (fun width line -> max width (String.length line)) 0 lines

let clip_lines (Height height) lines =
  let count = List.length lines in
  if count <= height then lines
  else
    let marker =
      Printf.sprintf "... %d line(s) clipped; increase --height"
        (count - height + 1)
      |> fit (frame_width lines)
    in
    let rec take remaining acc = function
      | _ when remaining <= 0 -> List.rev acc
      | [] -> List.rev acc
      | line :: rest -> take (remaining - 1) (line :: acc) rest
    in
    take (height - 1) [] lines @ [ marker ]

let clip ?height frame =
  match height with
  | None -> frame
  | Some height ->
      frame |> split_lines |> clip_lines height |> String.concat "\n"
