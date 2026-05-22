open Cmdliner

let ( let* ) = Result.bind

let parse_id label parse value =
  match parse value with
  | Ok id -> Ok id
  | Error message -> Error (label ^ ": " ^ message)

let parse_optional_id label parse = function
  | None -> Ok None
  | Some value ->
      let* id = parse_id label parse value in
      Ok (Some id)

type tui_mode = Auto | Always | Never

let tui_mode_to_string = function
  | Auto -> "auto"
  | Always -> "always"
  | Never -> "never"

let tui_mode_conv =
  Arg.enum [ ("auto", Auto); ("always", Always); ("never", Never) ]

let state_dashboard_model lines state_path =
  match Ta_core.State_file.load ~path:state_path with
  | Error error -> Error (Ta_core.State_file.error_to_string error)
  | Ok store ->
      let runtime = Ta_core.Runtime_snapshot.collect ~lines store in
      Ok (Ta_core.Dashboard_model.of_state_runtime store runtime)

let config_dashboard_model lines config_path =
  match Ta_core.Workspace_config.load config_path with
  | Error errors ->
      Error
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config -> (
      match Ta_core.State_store.of_config config with
      | Error errors ->
          Error
            (String.concat "\n"
               (List.map Ta_core.Workspace_config.error_to_string errors))
      | Ok store ->
          let runtime = Ta_core.Runtime_snapshot.collect ~lines store in
          Ok (Ta_core.Dashboard_model.of_state_runtime store runtime))

let dashboard_timestamp () =
  match Ta_core.Dashboard_refresh_cadence.timestamp (Unix.gettimeofday ()) with
  | Ok timestamp -> timestamp
  | Error message -> invalid_arg message

let replay_dashboard_keys refresh interaction keys =
  let rec loop runner = function
    | [] -> Ok (Ta_core.Dashboard_runner.interaction runner)
    | key :: rest ->
        let event =
          Ta_core.Dashboard_runner.key_event ~at:(dashboard_timestamp ()) key
        in
        let step = Ta_core.Dashboard_runner.step ~refresh runner event in
        loop step.state rest
  in
  loop (Ta_core.Dashboard_runner.of_interaction interaction) keys

let parse_dashboard_height = function
  | None -> Ok None
  | Some value -> (
      match Ta_core.Dashboard_viewport.height value with
      | Ok height -> Ok (Some height)
      | Error _ -> Error "--height must be positive")

let should_run_tui tui_mode =
  let miaou_headless = Sys.getenv_opt "MIAOU_DRIVER" = Some "headless" in
  match tui_mode with
  | Never -> Ok false
  | Auto ->
      Ok (miaou_headless || (Unix.isatty Unix.stdin && Unix.isatty Unix.stdout))
  | Always ->
      if miaou_headless || (Unix.isatty Unix.stdin && Unix.isatty Unix.stdout)
      then Ok true
      else Error "--tui=always requires stdin and stdout to be terminals"

let render_static_dashboard lines width height interaction =
  print_endline
    (Ta_core.Dashboard_interaction.render ~width ?height ~lines interaction);
  `Ok 0

let render_dashboard_model ~refresh lines width height workspace agent keys
    tui_mode dashboard =
  if lines < 1 then (
    prerr_endline "--lines must be positive";
    `Ok 2)
  else if lines > Ta_core.Runtime_snapshot.max_preview_lines then (
    prerr_endline
      ("--lines must be at most "
      ^ string_of_int Ta_core.Runtime_snapshot.max_preview_lines);
    `Ok 2)
  else if width < 1 then (
    prerr_endline "--width must be positive";
    `Ok 2)
  else
    let height =
      match parse_dashboard_height height with
      | Ok height -> Ok height
      | Error message ->
          prerr_endline message;
          Error ()
    in
    match height with
    | Error () -> `Ok 2
    | Ok height -> (
        let interaction = Ta_core.Dashboard_interaction.init dashboard in
        match
          let* workspace =
            parse_optional_id "--workspace" Ta_core.Id.Workspace.of_string
              workspace
          in
          let* agent =
            parse_optional_id "--agent" Ta_core.Id.Agent.of_string agent
          in
          Ta_core.Dashboard_interaction.select ?workspace ?agent interaction
        with
        | Error message ->
            prerr_endline message;
            `Ok 2
        | Ok interaction -> (
            match replay_dashboard_keys refresh interaction keys with
            | Error message ->
                prerr_endline message;
                `Ok 2
            | Ok interaction -> (
                match should_run_tui tui_mode with
                | Error message ->
                    prerr_endline message;
                    `Ok 2
                | Ok true -> `Ok (Ta_tui.run ~lines ~refresh interaction)
                | Ok false ->
                    render_static_dashboard lines width height interaction)))

let render_state_dashboard lines width height workspace agent keys tui_mode
    state_path =
  match state_dashboard_model lines state_path with
  | Error message ->
      prerr_endline message;
      `Ok 1
  | Ok dashboard ->
      render_dashboard_model
        ~refresh:(fun () -> state_dashboard_model lines state_path)
        lines width height workspace agent keys tui_mode dashboard

let render_config_dashboard lines width height workspace agent keys tui_mode
    config_path =
  match config_dashboard_model lines config_path with
  | Error message ->
      prerr_endline message;
      `Ok 1
  | Ok dashboard ->
      render_dashboard_model
        ~refresh:(fun () -> config_dashboard_model lines config_path)
        lines width height workspace agent keys tui_mode dashboard

let dashboard lines width height workspace agent keys tui_mode state_path
    config_path =
  match
    Ta_core.Startup_paths.resolve ~exists:Sys.file_exists ?state_path
      ?config_path ()
  with
  | Ta_core.Startup_paths.State { path; explicit = _ } ->
      render_state_dashboard lines width height workspace agent keys tui_mode
        path
  | Ta_core.Startup_paths.Config { path; explicit = _ } ->
      render_config_dashboard lines width height workspace agent keys tui_mode
        path
  | Ta_core.Startup_paths.Missing ->
      print_endline Ta_core.Startup_guide.text;
      `Ok 0

let config_arg =
  Arg.(
    value
    & opt (some file) None
    & info [ "config"; "c" ] ~docv:"CONFIG" ~doc:"TA workspace config")

let state_arg =
  Arg.(
    value
    & opt (some file) None
    & info [ "state"; "s" ] ~docv:"STATE"
        ~doc:"TA state snapshot used for the dashboard frame")

let lines_arg =
  Arg.(
    value & opt int 20
    & info [ "lines" ] ~docv:"N"
        ~doc:
          ("Pane preview lines to capture per attached agent, max "
          ^ string_of_int Ta_core.Runtime_snapshot.max_preview_lines))

let width_arg =
  Arg.(
    value & opt int 100
    & info [ "width" ] ~docv:"COLS"
        ~doc:
          "Dashboard frame width for static output; full-screen TUI mode uses \
           the terminal width")

let height_arg =
  Arg.(
    value
    & opt (some int) None
    & info [ "height" ] ~docv:"ROWS"
        ~doc:
          "Optional dashboard frame height for static viewport clipping; \
           full-screen TUI mode uses the terminal height")

let workspace_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "workspace"; "w" ] ~docv:"WORKSPACE"
        ~doc:"Initially selected workspace id")

let agent_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "agent"; "a" ] ~docv:"AGENT" ~doc:"Initially selected agent id")

let key_arg =
  Arg.(
    value & opt_all string []
    & info [ "key" ] ~docv:"KEY"
        ~doc:"Replay one dashboard key before rendering; may be repeated")

let tui_arg =
  Arg.(
    value & opt tui_mode_conv Auto
    & info [ "tui" ] ~docv:"MODE"
        ~doc:
          ("Full-screen dashboard mode: "
         ^ "auto enters the TUI on a real terminal or when \
            MIAOU_DRIVER=headless, always requires a terminal unless \
            MIAOU_DRIVER=headless is set, never renders one static frame. \
            Values: auto, always, never. Default: " ^ tui_mode_to_string Auto))

let root_cmd =
  let doc = "Launch the TA roster-agent workspace manager." in
  let man =
    [
      `S Manpage.s_description;
      `P
        "TA starts a roster-native terminal dashboard for tmux-backed agent \
         workspaces. With no flags it looks for the default state and config \
         files in the current workspace.";
      `S "DEFAULT STARTUP";
      `P
        ("State lookup order: "
        ^ Ta_core.Startup_paths.describe_candidates
            Ta_core.Startup_paths.state_candidates
        ^ ".");
      `P
        ("Config lookup order: "
        ^ Ta_core.Startup_paths.describe_candidates
            Ta_core.Startup_paths.config_candidates
        ^ ".");
      `P
        "If a state snapshot exists, TA renders the dashboard from that state. \
         If only a config exists, TA renders a config-backed dashboard without \
         attached panes so the UI still opens.";
      `S "STARTING FROM SOURCE";
      `Pre
        "cd ocaml/agent-manager\n\
         dune exec ta\n\
         mkdir -p .harness\n\
         cp /path/to/your-ta.json .harness/ta.json\n\
         dune exec tactl -- state save --output .ta-state.json .harness/ta.json\n\
         dune exec tactl -- launch start --state .ta-state.json .harness/ta.json\n\
         dune exec ta";
      `S "BUNDLED EXAMPLE";
      `Pre
        "cd ocaml/agent-manager\n\
         cp examples/ta.example.json ta.json\n\
         dune exec tactl -- state save --output .ta-state.json ta.json\n\
         dune exec tactl -- launch start --state .ta-state.json ta.json\n\
         dune exec ta";
      `S "CURRENT TUI STATUS";
      `P
        "TA uses the MIAOU terminal runner from the miaou-tui opam package for \
         the full-screen dashboard. Set MIAOU_DRIVER=headless for JSON-driven \
         test and automation runs.";
    ]
  in
  Cmd.v
    (Cmd.info "ta" ~version:"0.1.0" ~doc ~man)
    Term.(
      ret
        (const dashboard $ lines_arg $ width_arg $ height_arg $ workspace_arg
       $ agent_arg $ key_arg $ tui_arg $ state_arg $ config_arg))

let () = exit (Cmd.eval' root_cmd)
