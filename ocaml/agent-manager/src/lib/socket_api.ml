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
        match prepare_socket_path socket_path with
        | Error _ as error -> error
        | Ok () ->
            Unix.bind server (Unix.ADDR_UNIX socket_path);
            bound := true;
            Unix.listen server 16;
            let rec loop () =
              let client, _ = Unix.accept server in
              handle_client ~state_path client;
              if not once then loop ()
            in
            loop ();
            Ok ()
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
