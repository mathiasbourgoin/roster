open Cmdliner

let print_errors errors =
  List.iter
    (fun error ->
      prerr_endline (Ta_core.Workspace_config.error_to_string error))
    errors

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

let state_dashboard_model lines state_path =
  match Ta_core.State_file.load ~path:state_path with
  | Error error -> Error (Ta_core.State_file.error_to_string error)
  | Ok store ->
      let runtime = Ta_core.Runtime_snapshot.collect ~lines store in
      Ok (Ta_core.Dashboard_model.of_state_runtime store runtime)

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

let render_state_dashboard lines width height workspace agent keys state_path =
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
        match state_dashboard_model lines state_path with
        | Error message ->
            prerr_endline message;
            `Ok 1
        | Ok dashboard -> (
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
                match
                  replay_dashboard_keys
                    (fun () -> state_dashboard_model lines state_path)
                    interaction keys
                with
                | Error message ->
                    prerr_endline message;
                    `Ok 2
                | Ok interaction ->
                    print_endline
                      (Ta_core.Dashboard_interaction.render ~width ?height
                         ~lines interaction);
                    `Ok 0)))

let render_config_summary path =
  match Ta_core.Workspace_config.load path with
  | Error errors ->
      print_errors errors;
      `Ok 1
  | Ok config ->
      let errors = Ta_core.Workspace_config.validate config in
      if errors = [] then (
        print_endline "TA bootstrap dashboard";
        print_endline (Ta_core.Workspace_config.summarize config);
        print_endline
          "State dashboard: run tactl state save, then pass --state STATE.";
        `Ok 0)
      else (
        print_errors errors;
        `Ok 1)

let dashboard lines width height workspace agent keys state_path config_path =
  match state_path with
  | Some path ->
      render_state_dashboard lines width height workspace agent keys path
  | None -> (
      match config_path with
      | None ->
          print_endline "TA bootstrap dashboard";
          print_endline "No state provided. Pass --state state.json.";
          print_endline "No config provided. Pass --config .harness/ta.json.";
          `Ok 0
      | Some path -> render_config_summary path)

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
    & info [ "width" ] ~docv:"COLS" ~doc:"Dashboard frame width")

let height_arg =
  Arg.(
    value
    & opt (some int) None
    & info [ "height" ] ~docv:"ROWS"
        ~doc:"Optional dashboard frame height for viewport clipping")

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

let root_cmd =
  let doc = "Launch the TA roster-agent workspace manager." in
  Cmd.v
    (Cmd.info "ta" ~version:"0.1.0" ~doc)
    Term.(
      ret
        (const dashboard $ lines_arg $ width_arg $ height_arg $ workspace_arg
       $ agent_arg $ key_arg $ state_arg $ config_arg))

let () = exit (Cmd.eval' root_cmd)
