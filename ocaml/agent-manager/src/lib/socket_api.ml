type error = Io of string | Protocol of string

let error_to_string = function Io message | Protocol message -> message
let request_timeout_seconds = 2.0
let response_timeout_seconds = 30.0
let max_line_bytes = 1_048_576
let max_launch_file_bytes = 1_048_576
let unix_error_message error = Unix.error_message error

let remove_socket_noerr path =
  try
    let stats = Unix.lstat path in
    match stats.Unix.st_kind with Unix.S_SOCK -> Unix.unlink path | _ -> ()
  with Sys_error _ | Unix.Unix_error _ -> ()

let prepare_socket_path path =
  try
    let stats = Unix.lstat path in
    match stats.Unix.st_kind with
    | Unix.S_SOCK ->
        Unix.unlink path;
        Ok ()
    | _ -> Error (Io (path ^ ": exists and is not a Unix socket"))
  with
  | Unix.Unix_error (Unix.ENOENT, _, _) -> Ok ()
  | Sys_error message -> Error (Io message)
  | Unix.Unix_error (error, _, _) -> Error (Io (unix_error_message error))

let validate_socket_directory path =
  let dir = Filename.dirname path in
  try
    let stats = Unix.stat dir in
    match stats.Unix.st_kind with
    | Unix.S_DIR when stats.Unix.st_perm land 0o077 = 0 -> Ok ()
    | Unix.S_DIR ->
        Error
          (Io
             (dir
            ^ ": socket directory must not be accessible by group or others"))
    | _ -> Error (Io (dir ^ ": socket parent is not a directory"))
  with
  | Sys_error message -> Error (Io message)
  | Unix.Unix_error (error, _, _) -> Error (Io (unix_error_message error))

let write_all fd value =
  try
    let rec loop offset =
      if offset = String.length value then Ok ()
      else
        let written =
          Unix.write_substring fd value offset (String.length value - offset)
        in
        if written = 0 then Error "socket write returned 0"
        else loop (offset + written)
    in
    loop 0
  with Unix.Unix_error (error, _, _) -> Error (unix_error_message error)

let write_line fd value = write_all fd (value ^ "\n")

let encoded_response_length output =
  Socket_protocol.Success output |> Socket_protocol.encode_response
  |> String.length

let read_line ?(timeout_seconds = request_timeout_seconds) fd =
  let buffer = Buffer.create 256 in
  let byte = Bytes.create 1 in
  let deadline = Unix.gettimeofday () +. timeout_seconds in
  let rec loop () =
    if Buffer.length buffer > max_line_bytes then Error "request line too long"
    else
      let remaining = deadline -. Unix.gettimeofday () in
      if remaining <= 0.0 then Error "request timed out"
      else
        match Unix.select [ fd ] [] [] remaining with
        | [], _, _ -> Error "request timed out"
        | _ -> (
            try
              match Unix.read fd byte 0 1 with
              | 0 ->
                  if Buffer.length buffer = 0 then Error "empty request"
                  else Ok (Buffer.contents buffer)
              | _ ->
                  let char = Bytes.get byte 0 in
                  if Char.equal char '\n' then Ok (Buffer.contents buffer)
                  else (
                    Buffer.add_char buffer char;
                    loop ())
            with Unix.Unix_error (error, _, _) ->
              Error (unix_error_message error))
  in
  loop ()

let require_actor = function
  | Some actor -> Ok actor
  | None -> Error "actor is required for socket mutations"

let authorize_write store ~workspace ~actor ~agent =
  let ( let* ) = Result.bind in
  let* workspace_state = State_store.find_workspace store workspace in
  let* _actor = State_store.find_agent workspace_state actor in
  let* _agent = State_store.find_agent workspace_state agent in
  if Id.Agent.equal actor agent then Ok ()
  else if
    State_store.can_access store ~workspace ~from_agent:actor ~to_agent:agent
      Permission.Write
  then Ok ()
  else
    Error
      (Printf.sprintf "actor %s cannot write agent %s in workspace %s"
         (Id.Agent.to_string actor) (Id.Agent.to_string agent)
         (Id.Workspace.to_string workspace))

let authorize_read store ~workspace ~actor ~agent =
  let ( let* ) = Result.bind in
  let* workspace_state = State_store.find_workspace store workspace in
  let* _actor = State_store.find_agent workspace_state actor in
  let* _agent = State_store.find_agent workspace_state agent in
  if Id.Agent.equal actor agent then Ok ()
  else if
    State_store.can_access store ~workspace ~from_agent:actor ~to_agent:agent
      Permission.Read
  then Ok ()
  else
    Error
      (Printf.sprintf "actor %s cannot read agent %s in workspace %s"
         (Id.Agent.to_string actor) (Id.Agent.to_string agent)
         (Id.Workspace.to_string workspace))

let config_errors_to_string errors =
  errors |> List.map Workspace_config.error_to_string |> String.concat "\n"

let roster_errors_to_string errors =
  errors
  |> List.map (fun (error : Roster_index.error) ->
      error.path ^ ": " ^ error.message)
  |> String.concat "\n"

let validate_regular_file path =
  try
    let stats = Unix.stat path in
    match stats.Unix.st_kind with
    | Unix.S_REG when stats.Unix.st_size <= max_launch_file_bytes -> Ok ()
    | Unix.S_REG ->
        Error
          (Printf.sprintf "%s: file exceeds %d bytes" path max_launch_file_bytes)
    | _ -> Error (path ^ ": expected a regular file")
  with
  | Sys_error message -> Error (path ^ ": " ^ message)
  | Unix.Unix_error (error, _, _) ->
      Error (path ^ ": " ^ unix_error_message error)

let load_config ?roster_index config_path =
  let ( let* ) = Result.bind in
  let* () = validate_regular_file config_path in
  match Workspace_config.load config_path with
  | Error errors -> Error (config_errors_to_string errors)
  | Ok config -> (
      match roster_index with
      | None -> (
          match Workspace_config.validate config with
          | [] -> Ok config
          | errors -> Error (config_errors_to_string errors))
      | Some roster_path -> (
          let* () = validate_regular_file roster_path in
          match Roster_index.load roster_path with
          | Error errors -> Error (roster_errors_to_string errors)
          | Ok roster -> (
              match Workspace_config.validate_with_roster ~roster config with
              | [] -> Ok config
              | errors -> Error (config_errors_to_string errors))))

let launch_plan ~config_path ?roster_index () =
  let ( let* ) = Result.bind in
  let* config = load_config ?roster_index config_path in
  match
    Launch_plan.of_config ~config_dir:(Filename.dirname config_path) config
  with
  | Ok plan -> Ok plan
  | Error errors -> Error (config_errors_to_string errors)

let authorize_launch store ~actor plan =
  let rec workspaces = function
    | [] -> Ok ()
    | workspace :: rest ->
        let rec agents = function
          | [] -> workspaces rest
          | agent :: rest -> (
              match
                authorize_write store ~workspace:agent.Launch_plan.workspace
                  ~actor ~agent:agent.name
              with
              | Ok () -> agents rest
              | Error _ as error -> error)
        in
        agents workspace.Launch_plan.agents
  in
  workspaces plan.Launch_plan.workspaces

let preflight_launch_state state_path ~actor plan =
  match State_file.load ~path:state_path with
  | Error error -> Error (State_file.error_to_string error)
  | Ok store ->
      let ( let* ) = Result.bind in
      let* () = Launch_state.preflight store plan in
      authorize_launch store ~actor plan

let update_launch_state state_path ~actor attachments =
  match
    State_file.update ~path:state_path (fun store ->
        Launch_state.apply_attachments ~actor store attachments)
  with
  | Ok store -> Ok store
  | Error error -> Error (State_file.error_to_string error)

let launch_dry_run ~config_path ?roster_index () =
  match launch_plan ~config_path ?roster_index () with
  | Error message -> Socket_protocol.Failure message
  | Ok plan -> (
      match Launch_runtime.dry_run_lines plan with
      | Ok lines -> Socket_protocol.Success (String.concat "\n" lines)
      | Error error ->
          Socket_protocol.Failure (Launch_runtime.error_to_string error))

let launch_start state_path ~config_path ?roster_index ~actor () =
  match launch_plan ~config_path ?roster_index () with
  | Error message -> Socket_protocol.Failure message
  | Ok plan -> (
      match preflight_launch_state state_path ~actor plan with
      | Error message -> Socket_protocol.Failure message
      | Ok () -> (
          match Launch_runtime.run plan with
          | Error error ->
              Socket_protocol.Failure (Launch_runtime.error_to_string error)
          | Ok attachments -> (
              match update_launch_state state_path ~actor attachments with
              | Ok store ->
                  Socket_protocol.Success
                    (Printf.sprintf "launched: %d workspace(s), %d agent(s)\n%s"
                       (List.length plan.Launch_plan.workspaces)
                       (Launch_plan.agent_count plan)
                       (State_store.summarize store))
              | Error message ->
                  Launch_runtime.cleanup_plan plan;
                  Socket_protocol.Failure
                    (message
                   ^ "\n\
                      launch-created tmux sessions cleaned up after state \
                      update failure"))))

let runtime_snapshot state_path ~workspace ~agent ~actor ~lines =
  if lines < 1 then Socket_protocol.Failure "lines must be positive"
  else if lines > Runtime_snapshot.max_preview_lines then
    Socket_protocol.Failure
      ("lines must be at most "
      ^ string_of_int Runtime_snapshot.max_preview_lines)
  else
    match State_file.load ~path:state_path with
    | Error error -> Socket_protocol.Failure (State_file.error_to_string error)
    | Ok store -> (
        match authorize_read store ~workspace ~actor ~agent with
        | Error message -> Socket_protocol.Failure message
        | Ok () -> (
            match
              Runtime_snapshot.collect_agent ~lines store ~workspace ~agent
            with
            | Error message -> Socket_protocol.Failure message
            | Ok snapshot ->
                Socket_protocol.Success
                  (Yojson.Safe.to_string (Runtime_snapshot.to_yojson snapshot)))
        )

let dashboard_snapshot state_path ~actor ~lines =
  if lines < 1 then Socket_protocol.Failure "lines must be positive"
  else if lines > Runtime_snapshot.max_preview_lines then
    Socket_protocol.Failure
      ("lines must be at most "
      ^ string_of_int Runtime_snapshot.max_preview_lines)
  else
    match State_file.load ~path:state_path with
    | Error error -> Socket_protocol.Failure (State_file.error_to_string error)
    | Ok store -> (
        match Dashboard_snapshot.of_state_for_actor ~lines store ~actor with
        | Error message -> Socket_protocol.Failure message
        | Ok snapshot -> (
            match
              Dashboard_snapshot.to_bounded_yojson_string
                ~max_bytes:max_line_bytes
                ~encoded_length:encoded_response_length snapshot
            with
            | Ok output -> Socket_protocol.Success output
            | Error message -> Socket_protocol.Failure message))

let execute state_path = function
  | Socket_protocol.State_summary -> (
      match State_file.load ~path:state_path with
      | Ok store -> Socket_protocol.Success (State_store.summarize store)
      | Error error ->
          Socket_protocol.Failure (State_file.error_to_string error))
  | State_show { audit_limit } -> (
      if audit_limit < 0 then
        Socket_protocol.Failure "audit_limit must be non-negative"
      else
        match State_file.load ~path:state_path with
        | Ok store ->
            Socket_protocol.Success (State_store.describe ~audit_limit store)
        | Error error ->
            Socket_protocol.Failure (State_file.error_to_string error))
  | Runtime_snapshot { workspace; agent; actor; lines } ->
      runtime_snapshot state_path ~workspace ~agent ~actor ~lines
  | Dashboard_snapshot { actor; lines } ->
      dashboard_snapshot state_path ~actor ~lines
  | Set_status { workspace; agent; status; actor } -> (
      match
        State_file.update ~path:state_path (fun store ->
            let ( let* ) = Result.bind in
            let* actor = require_actor actor in
            let* () = authorize_write store ~workspace ~actor ~agent in
            State_store.set_agent_status store ~workspace ~agent ~status
              ~actor:(Some actor))
      with
      | Ok store -> Socket_protocol.Success (State_store.summarize store)
      | Error error ->
          Socket_protocol.Failure (State_file.error_to_string error))
  | Attach_pane { workspace; agent; pane; actor } -> (
      match
        State_file.update ~path:state_path (fun store ->
            let ( let* ) = Result.bind in
            let* actor = require_actor actor in
            let* () = authorize_write store ~workspace ~actor ~agent in
            State_store.attach_pane store ~workspace ~agent ~pane
              ~actor:(Some actor))
      with
      | Ok store -> Socket_protocol.Success (State_store.summarize store)
      | Error error ->
          Socket_protocol.Failure (State_file.error_to_string error))
  | Launch_dry_run { config_path; roster_index } ->
      launch_dry_run ~config_path ?roster_index ()
  | Launch_start { config_path; roster_index; actor } ->
      launch_start state_path ~config_path ?roster_index ~actor ()

let handle_client ~state_path client =
  try
    Fun.protect
      ~finally:(fun () -> Unix.close client)
      (fun () ->
        let response =
          match read_line client with
          | Error message -> Socket_protocol.Failure message
          | Ok line -> (
              match Socket_protocol.decode_request line with
              | Ok request -> execute state_path request
              | Error message -> Socket_protocol.Failure message)
        in
        ignore (write_line client (Socket_protocol.encode_response response)))
  with Sys_error _ | Unix.Unix_error _ -> ()

let serve ~socket_path ~state_path ~once () =
  let server = Unix.socket Unix.PF_UNIX Unix.SOCK_STREAM 0 in
  let bound = ref false in
  Fun.protect
    ~finally:(fun () ->
      Unix.close server;
      if !bound then remove_socket_noerr socket_path)
    (fun () ->
      try
        match validate_socket_directory socket_path with
        | Error _ as error -> error
        | Ok () -> (
            match prepare_socket_path socket_path with
            | Error _ as error -> error
            | Ok () ->
                Unix.bind server (Unix.ADDR_UNIX socket_path);
                bound := true;
                Unix.chmod socket_path 0o600;
                Unix.listen server 16;
                let rec loop () =
                  let client, _ = Unix.accept server in
                  handle_client ~state_path client;
                  if not once then loop ()
                in
                loop ();
                Ok ())
      with
      | Sys_error message -> Error (Io message)
      | Unix.Unix_error (error, _, _) -> Error (Io (Unix.error_message error)))

let request ~socket_path request =
  let client = Unix.socket Unix.PF_UNIX Unix.SOCK_STREAM 0 in
  Fun.protect
    ~finally:(fun () -> Unix.close client)
    (fun () ->
      try
        Unix.connect client (Unix.ADDR_UNIX socket_path);
        match write_line client (Socket_protocol.encode_request request) with
        | Error message -> Error (Io message)
        | Ok () -> (
            match
              read_line ~timeout_seconds:response_timeout_seconds client
            with
            | Error message -> Error (Io message)
            | Ok line -> (
                match Socket_protocol.decode_response line with
                | Ok response -> Ok response
                | Error message -> Error (Protocol message)))
      with
      | Sys_error message -> Error (Io message)
      | Unix.Unix_error (error, _, _) -> Error (Io (Unix.error_message error)))
