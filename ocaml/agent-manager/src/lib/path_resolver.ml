let normalize path =
  let absolute = not (Filename.is_relative path) in
  let parts = String.split_on_char '/' path in
  let rec loop acc = function
    | [] -> List.rev acc
    | ("" | ".") :: rest -> loop acc rest
    | ".." :: rest -> (
        match acc with
        | ".." :: _ when not absolute -> loop (".." :: acc) rest
        | _ :: tail -> loop tail rest
        | [] when absolute -> loop [] rest
        | [] -> loop [ ".." ] rest)
    | part :: rest -> loop (part :: acc) rest
  in
  match (absolute, loop [] parts) with
  | true, [] -> "/"
  | true, parts -> "/" ^ String.concat "/" parts
  | false, [] -> "."
  | false, parts -> String.concat "/" parts

let absolute ~cwd path =
  let path =
    if Filename.is_relative path then Filename.concat cwd path else path
  in
  normalize path

let resolve ~base path =
  let path =
    if Filename.is_relative path then Filename.concat base path else path
  in
  normalize path
