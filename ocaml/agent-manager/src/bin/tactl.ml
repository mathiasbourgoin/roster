open Cmdliner

let print_errors errors =
  List.iter
    (fun error ->
      prerr_endline (Ta_core.Workspace_config.error_to_string error))
    errors

let load_config path =
  match Ta_core.Workspace_config.load path with
  | Ok config ->
      let errors = Ta_core.Workspace_config.validate config in
      if errors = [] then Ok config else Error errors
  | Error errors -> Error errors

let validate_config path =
  match load_config path with
  | Ok config ->
      print_endline (Ta_core.Workspace_config.summarize config);
      `Ok 0
  | Error errors ->
      print_errors errors;
      `Ok 1

let summary path = validate_config path

let tmux_status session_name =
  match Ta_core.Tmux.session_of_string session_name with
  | Error message ->
      prerr_endline message;
      `Ok 2
  | Ok session -> (
      match Ta_core.Tmux.run (Has_session session) with
      | Ok _ ->
          print_endline ("tmux session exists: " ^ session_name);
          `Ok 0
      | Error error ->
          prerr_endline (Ta_core.Tmux.error_to_string error);
          `Ok 1)

let tmux_smoke session_name =
  let session =
    match session_name with
    | None -> Ok None
    | Some value -> (
        match Ta_core.Tmux.session_of_string value with
        | Ok session -> Ok (Some session)
        | Error message -> Error message)
  in
  match session with
  | Error message ->
      prerr_endline message;
      `Ok 2
  | Ok session -> (
      match Ta_core.Tmux.smoke ?session () with
      | Ok output ->
          print_endline (String.trim output);
          `Ok 0
      | Error error ->
          prerr_endline (Ta_core.Tmux.error_to_string error);
          `Ok 1)

let config_arg =
  Arg.(
    required
    & pos 0 (some file) None
    & info [] ~docv:"CONFIG" ~doc:".harness/ta.json or compatible file")

let session_arg =
  Arg.(required & pos 0 (some string) None & info [] ~docv:"SESSION")

let smoke_session_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "session" ] ~docv:"SESSION"
        ~doc:"Managed temporary tmux session name")

let validate_cmd =
  let doc = "Validate a TA workspace configuration file." in
  Cmd.v (Cmd.info "validate" ~doc)
    Term.(ret (const validate_config $ config_arg))

let summary_cmd =
  let doc = "Print a TA workspace configuration summary." in
  Cmd.v (Cmd.info "summary" ~doc) Term.(ret (const summary $ config_arg))

let tmux_status_cmd =
  let doc = "Check whether a tmux session exists." in
  Cmd.v (Cmd.info "status" ~doc) Term.(ret (const tmux_status $ session_arg))

let tmux_smoke_cmd =
  let doc = "Create, capture, and clean up a temporary tmux session." in
  Cmd.v (Cmd.info "smoke" ~doc)
    Term.(ret (const tmux_smoke $ smoke_session_arg))

let tmux_cmd =
  let doc = "tmux runtime diagnostics." in
  Cmd.group (Cmd.info "tmux" ~doc) [ tmux_status_cmd; tmux_smoke_cmd ]

let root_cmd =
  let doc = "Control TA roster-agent workspaces." in
  Cmd.group
    (Cmd.info "tactl" ~version:"0.1.0" ~doc)
    [ validate_cmd; summary_cmd; tmux_cmd ]

let () = exit (Cmd.eval' root_cmd)
