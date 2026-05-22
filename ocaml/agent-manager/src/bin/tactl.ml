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

let show_state audit_limit state_path =
  if audit_limit < 0 then (
    prerr_endline "--audit-limit must be non-negative";
    `Ok 2)
  else
    match Ta_core.State_file.load ~path:state_path with
    | Ok store ->
        print_endline (Ta_core.State_store.describe ~audit_limit store);
        `Ok 0
    | Error error ->
        print_state_file_error error;
        `Ok 1

let remove_noerr path = try Sys.remove path with Sys_error _ -> ()

let save_runtime_json ~path json =
  let temp_dir = Filename.dirname path in
  let temp_prefix = "." ^ Filename.basename path ^ "." in
  let temp_path, temp_channel =
    Filename.open_temp_file ~temp_dir temp_prefix ".tmp"
  in
  close_out temp_channel;
  let committed = ref false in
  Fun.protect
    ~finally:(fun () -> if not !committed then remove_noerr temp_path)
    (fun () ->
      Yojson.Safe.to_file temp_path json;
      Unix.chmod temp_path 0o600;
      Sys.rename temp_path path;
      committed := true)

let runtime_snapshot lines output_path state_path =
  if lines < 1 then (
    prerr_endline "--lines must be positive";
    `Ok 2)
  else if lines > Ta_core.Runtime_snapshot.max_preview_lines then (
    prerr_endline
      ("--lines must be at most "
      ^ string_of_int Ta_core.Runtime_snapshot.max_preview_lines);
    `Ok 2)
  else
    match Ta_core.State_file.load ~path:state_path with
    | Error error ->
        print_state_file_error error;
        `Ok 1
    | Ok store -> (
        let snapshot = Ta_core.Runtime_snapshot.collect ~lines store in
        let json = Ta_core.Runtime_snapshot.to_yojson snapshot in
        match output_path with
        | None ->
            print_endline (Yojson.Safe.pretty_to_string json);
            `Ok 0
        | Some path -> (
            try
              save_runtime_json ~path json;
              print_endline ("runtime snapshot written: " ^ path);
              print_endline (Ta_core.Runtime_snapshot.summarize snapshot);
              `Ok 0
            with
            | Sys_error message ->
                prerr_endline (path ^ ": " ^ message);
                `Ok 1
            | Unix.Unix_error (error, _, _) ->
                prerr_endline (path ^ ": " ^ Unix.error_message error);
                `Ok 1
            | Yojson.Json_error message ->
                prerr_endline (path ^ ": " ^ message);
                `Ok 1))

let parse_id label parse value =
  match parse value with
  | Ok id -> Ok id
  | Error message -> Error (label ^ ": " ^ message)

let parse_optional_id label parse = function
  | None -> Ok None
  | Some value ->
      let* id = parse_id label parse value in
      Ok (Some id)

let refresh_interaction refresh interaction =
  if Ta_core.Dashboard_interaction.refresh_requested interaction then
    match refresh () with
    | Ok dashboard ->
        Ta_core.Dashboard_interaction.refresh dashboard interaction
    | Error message ->
        Ta_core.Dashboard_interaction.refresh_failed message interaction
  else interaction

let replay_dashboard_keys ?refresh interaction keys =
  let rec loop interaction = function
    | [] -> interaction
    | key :: rest ->
        let interaction =
          Ta_core.Dashboard_interaction.handle_key interaction key
        in
        let interaction =
          match refresh with
          | None -> interaction
          | Some refresh -> refresh_interaction refresh interaction
        in
        loop interaction rest
  in
  loop interaction keys

let load_roster_dashboard roster_path dashboard =
  match roster_path with
  | None -> Ok dashboard
  | Some path -> (
      match Ta_core.Roster_index.load path with
      | Ok roster ->
          let root = Filename.dirname path in
          let roster =
            Ta_core.Roster_index.enrich_from_frontmatter ~root roster
          in
          Ok (Ta_core.Dashboard_model.enrich_with_roster roster dashboard)
      | Error errors ->
          Error
            (errors
            |> List.map Ta_core.Roster_index.error_to_string
            |> String.concat "\n"))

let render_dashboard_model ?refresh width workspace agent keys dashboard =
  let interaction = Ta_core.Dashboard_interaction.init dashboard in
  match
    let* workspace =
      parse_optional_id "--workspace" Ta_core.Id.Workspace.of_string workspace
    in
    let* agent = parse_optional_id "--agent" Ta_core.Id.Agent.of_string agent in
    Ta_core.Dashboard_interaction.select ?workspace ?agent interaction
  with
  | Error message ->
      prerr_endline message;
      `Ok 2
  | Ok interaction ->
      let interaction = replay_dashboard_keys ?refresh interaction keys in
      print_endline (Ta_core.Dashboard_interaction.render ~width interaction);
      `Ok 0

let state_dashboard_model roster_path lines state_path =
  match Ta_core.State_file.load ~path:state_path with
  | Error error -> Error (Ta_core.State_file.error_to_string error)
  | Ok store ->
      let runtime = Ta_core.Runtime_snapshot.collect ~lines store in
      Ta_core.Dashboard_model.of_state_runtime store runtime
      |> load_roster_dashboard roster_path

let render_dashboard lines width roster_path workspace agent keys state_path =
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
    match state_dashboard_model roster_path lines state_path with
    | Error message ->
        prerr_endline message;
        `Ok 1
    | Ok dashboard ->
        render_dashboard_model
          ~refresh:(fun () ->
            state_dashboard_model roster_path lines state_path)
          width workspace agent keys dashboard

let socket_dashboard_model roster_path socket_path lines actor =
  match
    Ta_core.Dashboard_socket_refresh.fetch_model ~socket_path ~actor ~lines ()
  with
  | Ok dashboard -> load_roster_dashboard roster_path dashboard
  | Error error ->
      Error (Ta_core.Dashboard_socket_refresh.error_to_string error)

let render_dashboard_socket socket_path lines width roster_path actor workspace
    agent keys =
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
    let actor =
      match parse_optional_id "--actor" Ta_core.Id.Agent.of_string actor with
      | Error message ->
          prerr_endline message;
          Error ()
      | Ok None ->
          prerr_endline "--actor is required for dashboard render-socket";
          Error ()
      | Ok (Some actor) -> Ok actor
    in
    match actor with
    | Error () -> `Ok 2
    | Ok actor -> (
        match socket_dashboard_model roster_path socket_path lines actor with
        | Error message ->
            prerr_endline message;
            `Ok 1
        | Ok dashboard ->
            render_dashboard_model
              ~refresh:(fun () ->
                socket_dashboard_model roster_path socket_path lines actor)
              width workspace agent keys dashboard)

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

let launch_plan roster_path config_path =
  match load_config ?roster_path config_path with
  | Error errors ->
      print_errors errors;
      `Ok 1
  | Ok config -> (
      match
        Ta_core.Launch_plan.of_config
          ~config_dir:(Filename.dirname config_path)
          config
      with
      | Error errors ->
          print_errors errors;
          `Ok 1
      | Ok plan ->
          print_endline (Ta_core.Launch_plan.describe plan);
          `Ok 0)

let build_launch_plan roster_path config_path =
  match load_config ?roster_path config_path with
  | Error errors -> Error (`Config errors)
  | Ok config -> (
      match
        Ta_core.Launch_plan.of_config
          ~config_dir:(Filename.dirname config_path)
          config
      with
      | Ok plan -> Ok plan
      | Error errors -> Error (`Config errors))

let print_launch_error = function
  | `Config errors -> print_errors errors
  | `Runtime error ->
      prerr_endline (Ta_core.Launch_runtime.error_to_string error)
  | `State_file error -> print_state_file_error error
  | `State_validation message -> prerr_endline message

let validate_launch_state state_path plan =
  match state_path with
  | None -> Ok ()
  | Some path -> (
      match Ta_core.State_file.load ~path with
      | Error error -> Error (`State_file error)
      | Ok store -> (
          match Ta_core.Launch_state.preflight store plan with
          | Ok () -> Ok ()
          | Error message -> Error (`State_validation message)))

let update_launch_state state_path attachments =
  match state_path with
  | None -> Ok None
  | Some path -> (
      match
        Ta_core.State_file.update ~path (fun store ->
            Ta_core.Launch_state.apply_attachments store attachments)
      with
      | Ok store -> Ok (Some (path, store))
      | Error error -> Error (`State_file error))

let print_launch_success plan state_update =
  Printf.printf "launched: %d workspace(s), %d agent(s)\n"
    (List.length plan.Ta_core.Launch_plan.workspaces)
    (Ta_core.Launch_plan.agent_count plan);
  match state_update with
  | None -> `Ok 0
  | Some (path, store) ->
      print_endline ("state snapshot updated: " ^ path);
      print_endline (Ta_core.State_store.summarize store);
      `Ok 0

let launch_start dry_run state_path roster_path config_path =
  match build_launch_plan roster_path config_path with
  | Error error ->
      print_launch_error error;
      `Ok 1
  | Ok plan -> (
      if dry_run then (
        match Ta_core.Launch_runtime.dry_run_lines plan with
        | Ok lines ->
            List.iter print_endline lines;
            `Ok 0
        | Error error ->
            print_launch_error (`Runtime error);
            `Ok 1)
      else
        match validate_launch_state state_path plan with
        | Error error ->
            print_launch_error error;
            `Ok 1
        | Ok () -> (
            match Ta_core.Launch_runtime.run plan with
            | Ok attachments -> (
                match update_launch_state state_path attachments with
                | Ok state_update -> print_launch_success plan state_update
                | Error error ->
                    Ta_core.Launch_runtime.cleanup_plan plan;
                    print_launch_error error;
                    prerr_endline
                      "launch-created tmux sessions cleaned up after state \
                       update failure";
                    `Ok 1)
            | Error error ->
                print_launch_error (`Runtime error);
                `Ok 1))

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

let print_socket_error error =
  prerr_endline (Ta_core.Socket_api.error_to_string error)

let socket_serve once socket_path state_path =
  match Ta_core.Socket_api.serve ~socket_path ~state_path ~once () with
  | Ok () -> `Ok 0
  | Error error ->
      print_socket_error error;
      `Ok 1

let require_socket_option label = function
  | Some value -> Ok value
  | None -> Error (label ^ " is required for this socket command")

let absolute_path path =
  if Filename.is_relative path then Filename.concat (Sys.getcwd ()) path
  else path

let absolute_path_option = function
  | None -> None
  | Some path -> Some (absolute_path path)

let require_socket_actor command actor =
  let* actor = parse_actor actor in
  match actor with
  | Some actor -> Ok actor
  | None -> Error ("--actor is required for " ^ command)

let validate_runtime_lines lines =
  if lines < 1 then Error "--lines must be positive"
  else if lines > Ta_core.Runtime_snapshot.max_preview_lines then
    Error
      ("--lines must be at most "
      ^ string_of_int Ta_core.Runtime_snapshot.max_preview_lines)
  else Ok ()

let build_socket_request command audit_limit runtime_lines config_path
    roster_path workspace agent status reason pane actor =
  if audit_limit < 0 then Error "--audit-limit must be non-negative"
  else
    match command with
    | "state-summary" -> Ok Ta_core.Socket_protocol.State_summary
    | "state-show" -> Ok (Ta_core.Socket_protocol.State_show { audit_limit })
    | "runtime-snapshot" ->
        let* workspace = require_socket_option "--workspace" workspace in
        let* agent = require_socket_option "--agent" agent in
        let* actor = require_socket_actor "runtime-snapshot" actor in
        let* () = validate_runtime_lines runtime_lines in
        let* workspace =
          parse_id "--workspace" Ta_core.Id.Workspace.of_string workspace
        in
        let* agent = parse_id "--agent" Ta_core.Id.Agent.of_string agent in
        Ok
          (Ta_core.Socket_protocol.Runtime_snapshot
             { workspace; agent; actor; lines = runtime_lines })
    | "dashboard-snapshot" ->
        let* actor = require_socket_actor "dashboard-snapshot" actor in
        let* () = validate_runtime_lines runtime_lines in
        Ok
          (Ta_core.Socket_protocol.Dashboard_snapshot
             { actor; lines = runtime_lines })
    | "launch-dry-run" ->
        let* config_path = require_socket_option "--config" config_path in
        Ok
          (Ta_core.Socket_protocol.Launch_dry_run
             {
               config_path = absolute_path config_path;
               roster_index = absolute_path_option roster_path;
             })
    | "launch-start" ->
        let* config_path = require_socket_option "--config" config_path in
        let* actor = require_socket_actor "launch-start" actor in
        Ok
          (Ta_core.Socket_protocol.Launch_start
             {
               config_path = absolute_path config_path;
               roster_index = absolute_path_option roster_path;
               actor;
             })
    | "set-status" ->
        let* workspace = require_socket_option "--workspace" workspace in
        let* agent = require_socket_option "--agent" agent in
        let* status = require_socket_option "--status" status in
        let* workspace =
          parse_id "--workspace" Ta_core.Id.Workspace.of_string workspace
        in
        let* agent = parse_id "--agent" Ta_core.Id.Agent.of_string agent in
        let* status = parse_status status reason in
        let* actor = parse_actor actor in
        Ok
          (Ta_core.Socket_protocol.Set_status
             { workspace; agent; status; actor })
    | "attach-pane" ->
        let* workspace = require_socket_option "--workspace" workspace in
        let* agent = require_socket_option "--agent" agent in
        let* pane = require_socket_option "--pane" pane in
        let* workspace =
          parse_id "--workspace" Ta_core.Id.Workspace.of_string workspace
        in
        let* agent = parse_id "--agent" Ta_core.Id.Agent.of_string agent in
        let* pane = parse_id "--pane" Ta_core.Id.Pane.of_string pane in
        let* actor = parse_actor actor in
        Ok
          (Ta_core.Socket_protocol.Attach_pane { workspace; agent; pane; actor })
    | value -> Error ("unknown socket command: " ^ value)

let socket_request socket_path audit_limit runtime_lines config_path roster_path
    workspace agent status reason pane actor command =
  match
    build_socket_request command audit_limit runtime_lines config_path
      roster_path workspace agent status reason pane actor
  with
  | Error message ->
      prerr_endline message;
      `Ok 2
  | Ok request -> (
      match Ta_core.Socket_api.request ~socket_path request with
      | Error error ->
          print_socket_error error;
          `Ok 1
      | Ok (Ta_core.Socket_protocol.Success output) ->
          print_endline output;
          `Ok 0
      | Ok (Ta_core.Socket_protocol.Failure error) ->
          prerr_endline error;
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

let audit_limit_arg =
  Arg.(
    value & opt int 10
    & info [ "audit-limit" ] ~docv:"N"
        ~doc:"Maximum number of recent audit events to print")

let runtime_lines_arg =
  Arg.(
    value & opt int 20
    & info [ "lines" ] ~docv:"N"
        ~doc:
          ("Pane preview lines to capture per attached agent, max "
          ^ string_of_int Ta_core.Runtime_snapshot.max_preview_lines))

let runtime_output_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "output"; "o" ] ~docv:"JSON"
        ~doc:"Optional runtime snapshot JSON output path")

let dashboard_width_arg =
  Arg.(
    value & opt int 100
    & info [ "width" ] ~docv:"COLS"
        ~doc:"Dashboard frame width used by the static renderer")

let dashboard_key_arg =
  Arg.(
    value & opt_all string []
    & info [ "key" ] ~docv:"KEY"
        ~doc:"Replay one dashboard key before rendering; may be repeated")

let socket_path_opt =
  Arg.(
    required
    & opt (some string) None
    & info [ "socket" ] ~docv:"SOCKET"
        ~doc:"TA Unix socket path inside a private owner-only directory")

let socket_state_arg =
  Arg.(
    required
    & opt (some string) None
    & info [ "state" ] ~docv:"STATE" ~doc:"State snapshot served by the socket")

let once_arg =
  Arg.(
    value & flag & info [ "once" ] ~doc:"Serve one socket request and then exit")

let socket_command_arg =
  Arg.(
    required
    & pos 0 (some string) None
    & info [] ~docv:"COMMAND"
        ~doc:
          "Socket command: state-summary, state-show, set-status, attach-pane, \
           runtime-snapshot, dashboard-snapshot, launch-dry-run, or \
           launch-start")

let socket_config_arg =
  Arg.(
    value
    & opt (some file) None
    & info [ "config" ] ~docv:"CONFIG"
        ~doc:"Workspace config for socket launch commands")

let socket_workspace_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "workspace"; "w" ] ~docv:"WORKSPACE" ~doc:"Workspace id")

let socket_agent_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "agent"; "a" ] ~docv:"AGENT" ~doc:"Agent id")

let socket_status_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "status" ] ~docv:"STATUS" ~doc:"Agent status for socket set-status")

let socket_reason_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "reason" ] ~docv:"TEXT"
        ~doc:"Reason required for blocked or failed socket status updates")

let socket_pane_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "pane" ] ~docv:"PANE" ~doc:"tmux pane id for socket attach-pane")

let socket_actor_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "actor" ] ~docv:"AGENT"
        ~doc:
          "Actor agent id for authorized socket requests, mutations, and \
           launch-start")

let smoke_session_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "session" ] ~docv:"SESSION"
        ~doc:"Managed temporary tmux session name")

let dry_run_arg =
  Arg.(
    value & flag
    & info [ "dry-run" ] ~doc:"Print tmux commands without executing them")

let launch_state_arg =
  Arg.(
    value
    & opt (some string) None
    & info [ "state" ] ~docv:"STATE"
        ~doc:"Write discovered tmux pane ids to a state snapshot after launch")

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

let state_show_cmd =
  let doc = "Print detailed state snapshot contents." in
  Cmd.v (Cmd.info "show" ~doc)
    Term.(ret (const show_state $ audit_limit_arg $ state_path_arg))

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
      state_show_cmd;
      state_set_status_cmd;
      state_attach_pane_cmd;
    ]

let runtime_snapshot_cmd =
  let doc = "Capture a cacheable runtime snapshot from attached tmux panes." in
  Cmd.v (Cmd.info "snapshot" ~doc)
    Term.(
      ret
        (const runtime_snapshot $ runtime_lines_arg $ runtime_output_arg
       $ state_path_arg))

let runtime_cmd =
  let doc = "Inspect live tmux runtime state for cached UI views." in
  Cmd.group (Cmd.info "runtime" ~doc) [ runtime_snapshot_cmd ]

let dashboard_render_cmd =
  let doc = "Render a static TA dashboard frame from state and tmux runtime." in
  Cmd.v (Cmd.info "render" ~doc)
    Term.(
      ret
        (const render_dashboard $ runtime_lines_arg $ dashboard_width_arg
       $ roster_arg $ socket_workspace_arg $ socket_agent_arg
       $ dashboard_key_arg $ state_path_arg))

let dashboard_render_socket_cmd =
  let doc =
    "Render a TA dashboard frame from the local socket control plane."
  in
  Cmd.v
    (Cmd.info "render-socket" ~doc)
    Term.(
      ret
        (const render_dashboard_socket
        $ socket_path_opt $ runtime_lines_arg $ dashboard_width_arg $ roster_arg
        $ socket_actor_arg $ socket_workspace_arg $ socket_agent_arg
        $ dashboard_key_arg))

let dashboard_cmd =
  let doc = "Render dashboard views for the future MIAOU TUI." in
  Cmd.group
    (Cmd.info "dashboard" ~doc)
    [ dashboard_render_cmd; dashboard_render_socket_cmd ]

let launch_plan_cmd =
  let doc = "Print a deterministic supervised tmux launch plan." in
  Cmd.v (Cmd.info "plan" ~doc)
    Term.(ret (const launch_plan $ roster_arg $ config_arg))

let launch_start_cmd =
  let doc = "Create supervised tmux sessions from a launch plan." in
  Cmd.v (Cmd.info "start" ~doc)
    Term.(
      ret
        (const launch_start $ dry_run_arg $ launch_state_arg $ roster_arg
       $ config_arg))

let launch_cmd =
  let doc = "Plan and run supervised tmux workspace launches." in
  Cmd.group (Cmd.info "launch" ~doc) [ launch_plan_cmd; launch_start_cmd ]

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

let socket_serve_cmd =
  let doc = "Serve the local TA Unix socket API." in
  Cmd.v (Cmd.info "serve" ~doc)
    Term.(
      ret (const socket_serve $ once_arg $ socket_path_opt $ socket_state_arg))

let socket_request_cmd =
  let doc = "Send one request to the local TA Unix socket API." in
  Cmd.v (Cmd.info "request" ~doc)
    Term.(
      ret
        (const socket_request $ socket_path_opt $ audit_limit_arg
       $ runtime_lines_arg $ socket_config_arg $ roster_arg
       $ socket_workspace_arg $ socket_agent_arg $ socket_status_arg
       $ socket_reason_arg $ socket_pane_arg $ socket_actor_arg
       $ socket_command_arg))

let socket_cmd =
  let doc = "Local Unix socket API for TA state." in
  Cmd.group (Cmd.info "socket" ~doc) [ socket_serve_cmd; socket_request_cmd ]

let root_cmd =
  let doc = "Control TA roster-agent workspaces." in
  Cmd.group
    (Cmd.info "tactl" ~version:"0.1.0" ~doc)
    [
      validate_cmd;
      summary_cmd;
      state_cmd;
      runtime_cmd;
      dashboard_cmd;
      launch_cmd;
      tmux_cmd;
      socket_cmd;
    ]

let () = exit (Cmd.eval' root_cmd)
