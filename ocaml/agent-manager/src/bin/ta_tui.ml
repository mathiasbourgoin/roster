module Direct_page = Miaou_core.Direct_page
module Tui_page = Miaou_core.Tui_page
module Widgets = Miaou_widgets_display.Widgets

type render_profile = { lines : int }

let split_lines value =
  let lines = String.split_on_char '\n' value in
  match List.rev lines with "" :: rest -> List.rev rest | _ -> lines

let dashboard_timestamp () =
  match Ta_core.Dashboard_refresh_cadence.timestamp (Unix.gettimeofday ()) with
  | Ok timestamp -> timestamp
  | Error message -> invalid_arg message

let tick_step ~refresh runner =
  let event = Ta_core.Dashboard_runner.tick_event (dashboard_timestamp ()) in
  let step = Ta_core.Dashboard_runner.step ~refresh runner event in
  step.state

let key_step ~refresh runner key =
  let event =
    Ta_core.Dashboard_runner.key_event ~at:(dashboard_timestamp ()) key
  in
  let step = Ta_core.Dashboard_runner.step ~refresh runner event in
  step.state

let dashboard_key = function "Shift-Tab" | "S-Tab" -> "BackTab" | key -> key

let main_segment line =
  match String.index_opt line '|' with
  | None -> String.trim line
  | Some index ->
      String.sub line (index + 1) (String.length line - index - 1)
      |> String.trim

let line_style index line =
  if index = 0 then Widgets.themed_primary (Widgets.bold line)
  else if index = 1 then Widgets.themed_muted line
  else if
    String.starts_with ~prefix:"Workspaces" line
    || String.starts_with ~prefix:"Agents" line
    || String.starts_with ~prefix:"Agent " (main_segment line)
    || String.starts_with ~prefix:"Pipeline" (main_segment line)
  then Widgets.themed_emphasis line
  else if String.starts_with ~prefix:"q quit" line then
    Widgets.themed_muted line
  else line

let render_layout profile runner ~size =
  let interaction = Ta_core.Dashboard_runner.interaction runner in
  let layout =
    Ta_core.Dashboard_tui_layout.render ~now:(Unix.gettimeofday ())
      ~lines:profile.lines ~show_footer:false
      ~width:(max 1 size.LTerm_geom.cols)
      ~height:(max 1 size.LTerm_geom.rows)
      interaction
  in
  layout |> Ta_core.Dashboard_tui_layout.to_text |> split_lines
  |> List.mapi line_style |> String.concat "\n"

let run ~lines ~refresh interaction =
  let profile = { lines } in
  let refresh_source = refresh in
  let initial = Ta_core.Dashboard_runner.of_interaction interaction in
  let module Page = Direct_page.Make (struct
    include Direct_page.With_defaults (struct
      type state = Ta_core.Dashboard_runner.t

      let init () = initial
      let view runner ~focus:_ ~size = render_layout profile runner ~size

      let on_key runner key ~size:_ =
        match key with
        | "q" | "Q" | "Esc" | "Escape" | "C-c" | "C-C" ->
            Direct_page.quit ();
            runner
        | key -> key_step ~refresh:refresh_source runner (dashboard_key key)
    end)

    let refresh runner = tick_step ~refresh:refresh_source runner

    let key_hints _ =
      [
        ("q", "quit");
        ("arrows/jk", "move");
        ("Tab", "focus");
        ("p", "pipeline");
        ("[ ]", "targets");
        ("r", "refresh");
      ]
  end) in
  Eio_main.run @@ fun env ->
  Eio.Switch.run @@ fun sw ->
  Miaou_helpers.Fiber_runtime.init ~env ~sw;
  let page : Miaou_core.Registry.page = (module Page : Tui_page.PAGE_SIG) in
  match Miaou_runner_tui.Runner_tui.run ~enable_mouse:false page with
  | `Quit | `Back | `SwitchTo _ -> 0
