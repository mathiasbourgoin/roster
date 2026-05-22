type error = Io of string | Protocol of string

let error_to_string = function Io message | Protocol message -> message
let client_timeout_seconds = 2.0
let max_line_bytes = 1_048_576
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

let read_line fd =
  let buffer = Buffer.create 256 in
  let byte = Bytes.create 1 in
  let deadline = Unix.gettimeofday () +. client_timeout_seconds in
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
            match read_line client with
            | Error message -> Error (Io message)
            | Ok line -> (
                match Socket_protocol.decode_response line with
                | Ok response -> Ok response
                | Error message -> Error (Protocol message)))
      with
      | Sys_error message -> Error (Io message)
      | Unix.Unix_error (error, _, _) -> Error (Io (Unix.error_message error)))
