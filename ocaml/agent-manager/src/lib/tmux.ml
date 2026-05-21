type session = string

type error = {
  argv : string list;
  status : Unix.process_status;
  output : string;
}

type command =
  | Has_session of session
  | New_detached_session of {
      session : session;
      cwd : string option;
      command : string list;
    }
  | Send_keys of { target : session; text : string }
  | Capture_pane of { target : session; lines : int }
  | Kill_session of session

let valid_char = function
  | 'a' .. 'z' | 'A' .. 'Z' | '0' .. '9' | '_' | '-' | '.' -> true
  | _ -> false

let rec all_valid value idx =
  if idx = String.length value then true
  else if valid_char value.[idx] then all_valid value (idx + 1)
  else false

let session_of_string value =
  if String.length value = 0 then Error "tmux session must not be empty"
  else if all_valid value 0 then Ok value
  else Error "tmux session may contain only letters, digits, '.', '_', and '-'"

let unsafe_session_of_string value =
  match session_of_string value with
  | Ok session -> session
  | Error message -> invalid_arg message

let session_to_string value = value

let quote_shell_word value =
  let buffer = Buffer.create (String.length value + 2) in
  Buffer.add_char buffer '\'';
  String.iter
    (function
      | '\'' -> Buffer.add_string buffer "'\\''"
      | char -> Buffer.add_char buffer char)
    value;
  Buffer.add_char buffer '\'';
  Buffer.contents buffer

let shell_command words =
  match words with
  | [] -> "true"
  | _ -> String.concat " " (List.map quote_shell_word words)

let argv = function
  | Has_session session -> [ "has-session"; "-t"; session ]
  | New_detached_session { session; cwd; command } -> (
      let shell_command = shell_command command in
      match cwd with
      | None -> [ "new-session"; "-d"; "-s"; session; shell_command ]
      | Some cwd ->
          [ "new-session"; "-d"; "-s"; session; "-c"; cwd; shell_command ])
  | Send_keys { target; text } -> [ "send-keys"; "-t"; target; text; "Enter" ]
  | Capture_pane { target; lines } ->
      [ "capture-pane"; "-p"; "-t"; target; "-S"; "-" ^ string_of_int lines ]
  | Kill_session session -> [ "kill-session"; "-t"; session ]

let read_all channel =
  let buffer = Buffer.create 256 in
  let bytes = Bytes.create 4096 in
  let rec loop () =
    match input channel bytes 0 (Bytes.length bytes) with
    | 0 -> Buffer.contents buffer
    | read ->
        Buffer.add_subbytes buffer bytes 0 read;
        loop ()
  in
  loop ()

let run command =
  let args = argv command in
  let argv_array = Array.of_list ("tmux" :: args) in
  let channel = Unix.open_process_args_in "tmux" argv_array in
  let output = read_all channel in
  match Unix.close_process_in channel with
  | Unix.WEXITED 0 -> Ok output
  | status -> Error { argv = "tmux" :: args; status; output }

let wait_short () =
  ignore (Unix.select [] [] [] 0.2 : Unix.file_descr list * _ * _)

let smoke ?session () =
  let session =
    match session with
    | Some session -> session
    | None ->
        unsafe_session_of_string ("ta-smoke-" ^ string_of_int (Unix.getpid ()))
  in
  let start =
    New_detached_session
      {
        session;
        cwd = None;
        command = [ "sh"; "-c"; "printf 'ta-smoke-ready\\n'; sleep 5" ];
      }
  in
  match run start with
  | Error error -> Error error
  | Ok _ ->
      wait_short ();
      let captured = run (Capture_pane { target = session; lines = 20 }) in
      let _cleanup = run (Kill_session session) in
      captured

let status_to_string = function
  | Unix.WEXITED code -> "exit " ^ string_of_int code
  | Unix.WSIGNALED signal -> "signal " ^ string_of_int signal
  | Unix.WSTOPPED signal -> "stopped " ^ string_of_int signal

let error_to_string { argv; status; output } =
  Printf.sprintf "%s failed with %s%s" (String.concat " " argv)
    (status_to_string status)
    (if String.length output = 0 then "" else ": " ^ String.trim output)
