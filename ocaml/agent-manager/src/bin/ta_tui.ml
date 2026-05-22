open Notty
module Term = Notty_unix.Term

type event = Quit | Dashboard_key of string | Tick | Redraw

let split_lines value =
  let length = String.length value in
  let rec loop start idx acc =
    if idx = length then
      let acc =
        if start = idx then "" :: acc
        else String.sub value start (idx - start) :: acc
      in
      List.rev acc
    else if Char.equal value.[idx] '\n' then
      let line = String.sub value start (idx - start) in
      loop (idx + 1) (idx + 1) (line :: acc)
    else loop start (idx + 1) acc
  in
  match loop 0 0 [] with
  | [] -> []
  | lines -> (
      match List.rev lines with "" :: rest -> List.rev rest | _ -> lines)

let dashboard_timestamp () =
  match Ta_core.Dashboard_refresh_cadence.timestamp (Unix.gettimeofday ()) with
  | Ok timestamp -> timestamp
  | Error message -> invalid_arg message

let viewport_height rows =
  match Ta_core.Dashboard_viewport.height (max 1 rows) with
  | Ok height -> height
  | Error message -> invalid_arg message

let footer = " q quit | arrows move | p pipeline | [ ] targets | r refresh "

let line_image idx line =
  let attr =
    if idx = 0 then A.(fg lightcyan ++ st bold)
    else if String.starts_with ~prefix:"TA Dashboard" line then
      A.(fg lightgreen ++ st bold)
    else A.empty
  in
  if String.equal line "" then I.void 0 1 else I.string attr line

let image_of_lines lines =
  match lines with
  | [] -> I.empty
  | line :: rest ->
      List.fold_left
        (fun image (idx, line) -> I.(image <-> line_image idx line))
        (line_image 0 line)
        (List.mapi (fun idx line -> (idx + 1, line)) rest)

let render interaction ~cols ~rows ~lines =
  let body_rows = max 1 (rows - 1) in
  let height = viewport_height body_rows in
  let body =
    Ta_core.Dashboard_interaction.render ~width:(max 1 cols) ~height ~lines
      interaction
    |> split_lines |> image_of_lines
  in
  let footer =
    I.string A.(fg lightblack) footer |> fun image ->
    if rows > 1 then image else I.empty
  in
  I.(body <-> footer)

let event_of_notty = function
  | `End -> Quit
  | `Resize _ -> Redraw
  | `Mouse _ | `Paste _ -> Redraw
  | `Key (`Escape, _) -> Quit
  | `Key (`ASCII ('q' | 'Q'), _) -> Quit
  | `Key (`ASCII ('c' | 'C'), mods) when List.mem `Ctrl mods -> Quit
  | `Key (`Arrow `Up, _) -> Dashboard_key "Up"
  | `Key (`Arrow `Down, _) -> Dashboard_key "Down"
  | `Key (`Arrow `Left, _) -> Dashboard_key "Left"
  | `Key (`Arrow `Right, _) -> Dashboard_key "Right"
  | `Key (`Tab, mods) when List.mem `Shift mods -> Dashboard_key "BackTab"
  | `Key (`Tab, _) -> Dashboard_key "Tab"
  | `Key (`Enter, _) -> Dashboard_key "Enter"
  | `Key (`ASCII '[', _) -> Dashboard_key "["
  | `Key (`ASCII ']', _) -> Dashboard_key "]"
  | `Key (`ASCII ('p' | 'P'), _) -> Dashboard_key "p"
  | `Key (`ASCII ('r' | 'R'), _) -> Dashboard_key "r"
  | `Key _ -> Redraw

let read_event term =
  let input, _output = Term.fds term in
  let wait_seconds = 0.25 in
  let ready, _, _ = Unix.select [ input ] [] [] wait_seconds in
  if ready = [] then Tick else event_of_notty (Term.event term)

let key_step ~refresh runner key =
  let event =
    Ta_core.Dashboard_runner.key_event ~at:(dashboard_timestamp ()) key
  in
  let step = Ta_core.Dashboard_runner.step ~refresh runner event in
  step.state

let tick_step ~refresh runner =
  let event = Ta_core.Dashboard_runner.tick_event (dashboard_timestamp ()) in
  let step = Ta_core.Dashboard_runner.step ~refresh runner event in
  step.state

let run ~lines ~refresh interaction =
  let term = Term.create ~mouse:false ~bpaste:false () in
  Fun.protect
    ~finally:(fun () -> Term.release term)
    (fun () ->
      let rec draw runner =
        let cols, rows = Term.size term in
        let interaction = Ta_core.Dashboard_runner.interaction runner in
        Term.image term (render interaction ~cols ~rows ~lines)
      and loop runner =
        draw runner;
        match read_event term with
        | Quit -> 0
        | Redraw -> loop runner
        | Tick -> loop (tick_step ~refresh runner)
        | Dashboard_key key -> loop (key_step ~refresh runner key)
      in
      loop (Ta_core.Dashboard_runner.of_interaction interaction))
