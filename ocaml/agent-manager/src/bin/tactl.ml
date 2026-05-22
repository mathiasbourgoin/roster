open Cmdliner

let print_errors errors =
  List.iter
    (fun error ->
      prerr_endline (Ta_core.Workspace_config.error_to_string error))
    errors

let roster_errors_to_config_errors errors =
  List.map
    (fun (error : Ta_core.Roster_index.error) ->
      { Ta_core.Workspace_config.path = error.path; message = error.message })
    errors

let load_config ?roster_path path =
  match Ta_core.Workspace_config.load path with
  | Ok config ->
      let errors =
        match roster_path with
        | None -> Ta_core.Workspace_config.validate config
        | Some roster_path -> (
            match Ta_core.Roster_index.load roster_path with
            | Ok roster ->
                Ta_core.Workspace_config.validate_with_roster ~roster config
            | Error errors -> roster_errors_to_config_errors errors)
      in
      if errors = [] then Ok config else Error errors
  | Error errors -> Error errors

let validate_config roster_path path =
  match load_config ?roster_path path with
  | Ok config ->
      print_endline (Ta_core.Workspace_config.summarize config);
      `Ok 0
  | Error errors ->
      print_errors errors;
      `Ok 1

let summary roster_path path = validate_config roster_path path

let print_state_file_error error =
  prerr_endline (Ta_core.State_file.error_to_string error)

let ( let* ) = Result.bind

let save_state roster_path output_path config_path =
  match load_config ?roster_path config_path with
  | Error errors ->
      print_errors errors;
      `Ok 1
  | Ok config -> (
      match Ta_core.State_store.of_config config with
      | Error errors ->
          print_errors errors;
          `Ok 1
      | Ok store -> (
          match Ta_core.State_file.save ~path:output_path store with
          | Ok () ->
              print_endline ("state snapshot written: " ^ output_path);
              `Ok 0
          | Error error ->
              print_state_file_error error;
              `Ok 1))

let load_state state_path =
  match Ta_core.State_file.load ~path:state_path with
  | Ok store ->
      print_endline (Ta_core.State_store.summarize store);
      `Ok 0
  | Error error ->
      print_state_file_error error;
      `Ok 1

let parse_id label parse value =
  match parse value with
  | Ok id -> Ok id
  | Error message -> Error (label ^ ": " ^ message)

let parse_actor = function
  | None -> Ok None
  | Some value ->
      let* actor = parse_id "--actor" Ta_core.Id.Agent.of_string value in
      Ok (Some actor)

let parse_status status reason =
  match Ta_core.State_store.status_of_string ?reason status with
  | Ok status -> Ok status
  | Error message -> Error ("--status: " ^ message)

let print_updated_state state_path store =
  print_endline ("state snapshot updated: " ^ state_path);
  print_endline (Ta_core.State_store.summarize store);
  `Ok 0

let mutate_state state_path mutation =
  match Ta_core.State_file.update ~path:state_path mutation with
  | Ok updated -> print_updated_state state_path updated
  | Error error ->
      print_state_file_error error;
      `Ok 1

let set_state_status state_path workspace agent status reason actor =
  match
    let* workspace =
      parse_id "--workspace" Ta_core.Id.Workspace.of_string workspace
    in
    let* agent = parse_id "--agent" Ta_core.Id.Agent.of_string agent in
    let* status = parse_status status reason in
    let* actor = parse_actor actor in
    Ok (workspace, agent, status, actor)
  with
  | Error message ->
      prerr_endline message;
      `Ok 2
  | Ok (workspace, agent, status, actor) ->
      mutate_state state_path (fun store ->
          Ta_core.State_store.set_agent_status store ~workspace ~agent ~status
            ~actor)

let attach_state_pane state_path workspace agent pane actor =
  match
    let* workspace =
      parse_id "--workspace" Ta_core.Id.Workspace.of_string workspace
    in
    let* agent = parse_id "--agent" Ta_core.Id.Agent.of_string agent in
    let* pane = parse_id "--pane" Ta_core.Id.Pane.of_string pane in
    let* actor = parse_actor actor in
    Ok (workspace, agent, pane, actor)
  with
  | Error message ->
      prerr_endline message;
      `Ok 2
  | Ok (workspace, agent, pane, actor) ->
      mutate_state state_path (fun store ->
          Ta_core.State_store.attach_pane store ~workspace ~agent ~pane ~actor)

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

let roster_arg =
  Arg.(
    value
    & opt (some file) None
    & info [ "roster-index" ] ~docv:"INDEX"
        ~doc:"Optional agent-roster index.json for roster_agent validation")

let session_arg =
  Arg.(required & pos 0 (some string) None & info [] ~docv:"SESSION")

let state_path_arg =
  Arg.(
    required
    & pos 0 (some string) None
    & info [] ~docv:"STATE" ~doc:"TA state snapshot JSON file")

let output_arg =
  Arg.(
    required
    & opt (some string) None
    & info [ "output"; "o" ] ~docv:"STATE"
        ~doc:"Path where the state snapshot will be written")

let workspace_arg =
  Arg.(
    required
    & opt (some string) None
    & info [ "workspace"; "w" ] ~docv:"WORKSPACE" ~doc:"Workspace id")

let agent_arg =
  Arg.(
    required
    & opt (some string) None
    & info [ "agent"; "a" ] ~docv:"AGENT" ~doc:"Agent id")

let actor_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "actor" ] ~docv:"AGENT"
        ~doc:"Optional actor agent id for the audit event")

let status_arg =
  Arg.(
    required
    & opt (some string) None
    & info [ "status" ] ~docv:"STATUS"
        ~doc:
          "Agent status: not-started, starting, running, idle, blocked, done, \
           failed")

let reason_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "reason" ] ~docv:"TEXT"
        ~doc:"Reason required for blocked or failed status")

let pane_arg =
  Arg.(
    required
    & opt (some string) None
    & info [ "pane" ] ~docv:"PANE" ~doc:"tmux pane id to attach")

let smoke_session_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "session" ] ~docv:"SESSION"
        ~doc:"Managed temporary tmux session name")

let validate_cmd =
  let doc = "Validate a TA workspace configuration file." in
  Cmd.v (Cmd.info "validate" ~doc)
    Term.(ret (const validate_config $ roster_arg $ config_arg))

let summary_cmd =
  let doc = "Print a TA workspace configuration summary." in
  Cmd.v (Cmd.info "summary" ~doc)
    Term.(ret (const summary $ roster_arg $ config_arg))

let state_save_cmd =
  let doc = "Create an initial state snapshot from a workspace config." in
  Cmd.v (Cmd.info "save" ~doc)
    Term.(ret (const save_state $ roster_arg $ output_arg $ config_arg))

let state_load_cmd =
  let doc = "Load and validate a state snapshot file." in
  Cmd.v (Cmd.info "load" ~doc) Term.(ret (const load_state $ state_path_arg))

let state_set_status_cmd =
  let doc = "Update an agent status in a state snapshot." in
  Cmd.v
    (Cmd.info "set-status" ~doc)
    Term.(
      ret
        (const set_state_status $ state_path_arg $ workspace_arg $ agent_arg
       $ status_arg $ reason_arg $ actor_arg))

let state_attach_pane_cmd =
  let doc = "Attach a tmux pane id to an agent in a state snapshot." in
  Cmd.v
    (Cmd.info "attach-pane" ~doc)
    Term.(
      ret
        (const attach_state_pane $ state_path_arg $ workspace_arg $ agent_arg
       $ pane_arg $ actor_arg))

let state_cmd =
  let doc = "Persist and inspect TA state snapshots." in
  Cmd.group (Cmd.info "state" ~doc)
    [
      state_save_cmd;
      state_load_cmd;
      state_set_status_cmd;
      state_attach_pane_cmd;
    ]

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
    [ validate_cmd; summary_cmd; state_cmd; tmux_cmd ]

let () = exit (Cmd.eval' root_cmd)
