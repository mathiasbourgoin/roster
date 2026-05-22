module Direct_page = Miaou_core.Direct_page
module Tui_page = Miaou_core.Tui_page

type start_agent =
  workspace:Ta_core.Id.Workspace.t ->
  agent:Ta_core.Id.Agent.t ->
  (Ta_core.Dashboard_model.t, string) result

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

let selected_start_target runner =
  let interaction = Ta_core.Dashboard_runner.interaction runner in
  match
    ( Ta_core.Dashboard_interaction.selected_workspace interaction,
      Ta_core.Dashboard_interaction.selected_agent interaction )
  with
  | Some workspace, Some agent -> Ok (interaction, workspace, agent)
  | _ -> Error (interaction, "no selected workspace/agent to start")

let update_interaction runner interaction =
  Ta_core.Dashboard_runner.with_interaction interaction runner

let start_step ~start runner =
  match selected_start_target runner with
  | Error (interaction, message) ->
      Ta_core.Dashboard_interaction.refresh_failed message interaction
      |> update_interaction runner
  | Ok (interaction, workspace, agent) -> (
      match start ~workspace ~agent with
      | Ok model ->
          Ta_core.Dashboard_interaction.refresh model interaction
          |> update_interaction runner
      | Error message ->
          Ta_core.Dashboard_interaction.refresh_failed message interaction
          |> update_interaction runner)

let run ~lines ~refresh ~start interaction =
  let profile = Ta_miaou_view.{ lines } in
  let refresh_source = refresh in
  let initial =
    Ta_core.Dashboard_runner.of_interaction
      ~refreshed_at:(dashboard_timestamp ()) interaction
  in
  let module Page = Direct_page.Make (struct
    include Direct_page.With_defaults (struct
      type state = Ta_core.Dashboard_runner.t

      let init () = initial
      let view runner ~focus:_ ~size = Ta_miaou_view.render profile runner ~size

      let on_key runner key ~size:_ =
        match key with
        | "q" | "Q" | "Esc" | "Escape" | "C-c" | "C-C" ->
            Direct_page.quit ();
            runner
        | "s" | "S" -> start_step ~start runner
        | key -> key_step ~refresh:refresh_source runner (dashboard_key key)
    end)

    let refresh runner = tick_step ~refresh:refresh_source runner

    let key_hints _ =
      [
        ("q", "quit");
        ("arrows/jk", "move");
        ("Tab", "focus");
        ("p", "pipeline");
        ("s", "start");
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
