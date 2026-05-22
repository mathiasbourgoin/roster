type session = string
type target = string
type pane_identity = { session_id : string; window_id : string }

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
  | New_detached_session_with_pane_id of {
      session : session;
      cwd : string option;
      command : string list;
    }
  | Split_window of {
      target : target;
      cwd : string option;
      command : string list;
    }
  | Split_window_with_pane_id of {
      target : target;
      cwd : string option;
      command : string list;
    }
  | Select_layout of { target : target; layout : string }
  | Send_keys of { target : session; text : string }
  | Send_keys_literal of { target : target; text : string }
  | Send_keys_to of { target : target; text : string }
  | Capture_pane of { target : target; lines : int }
  | Display_pane_id of target
  | Display_session_name of target
  | Display_pane_identity of target
  | Kill_session of session

let valid_session_char = function
  | 'a' .. 'z' | 'A' .. 'Z' | '0' .. '9' | '_' | '-' | '.' -> true
  | _ -> false

let valid_target_char = function
  | 'a' .. 'z' | 'A' .. 'Z' | '0' .. '9' | '_' | '-' | '.' | ':' | '%' -> true
  | _ -> false

let rec all_valid valid_char value idx =
  if idx = String.length value then true
  else if valid_char value.[idx] then all_valid valid_char value (idx + 1)
  else false

let session_of_string value =
  if String.length value = 0 then Error "tmux session must not be empty"
  else if all_valid valid_session_char value 0 then Ok value
  else Error "tmux session may contain only letters, digits, '.', '_', and '-'"

let unsafe_session_of_string value =
  match session_of_string value with
  | Ok session -> session
  | Error message -> invalid_arg message

let session_to_string value = value
let equal_session = String.equal
let compare_session = String.compare

let target_of_string value =
  if String.length value = 0 then Error "tmux target must not be empty"
  else if all_valid valid_target_char value 0 then Ok value
  else
    Error
      "tmux target may contain only letters, digits, '.', '_', '-', ':', and \
       '%'"

let unsafe_target_of_string value =
  match target_of_string value with
  | Ok target -> target
  | Error message -> invalid_arg message

let target_to_string value = value

let all_digits value start =
  let rec loop idx =
    if idx = String.length value then true
    else match value.[idx] with '0' .. '9' -> loop (idx + 1) | _ -> false
  in
  start < String.length value && loop start

let tmux_id label prefix value =
  if String.length value < 2 || not (Char.equal value.[0] prefix) then
    Error
      (Printf.sprintf "%s must start with %c followed by digits" label prefix)
  else if all_digits value 1 then Ok value
  else
    Error
      (Printf.sprintf "%s must start with %c followed by digits" label prefix)

let pane_identity_of_strings ~session_id ~window_id =
  match
    ( tmux_id "tmux session id" '$' session_id,
      tmux_id "tmux window id" '@' window_id )
  with
  | Ok session_id, Ok window_id -> Ok { session_id; window_id }
  | Error message, _ | _, Error message -> Error message

let unsafe_pane_identity ~session_id ~window_id =
  match pane_identity_of_strings ~session_id ~window_id with
  | Ok identity -> identity
  | Error message -> invalid_arg message

let parse_pane_identity value =
  match String.split_on_char '\t' (String.trim value) with
  | [ session_id; window_id ] -> pane_identity_of_strings ~session_id ~window_id
  | _ -> Error "tmux pane identity must be session_id<TAB>window_id"

let equal_pane_identity left right =
  String.equal left.session_id right.session_id
  && String.equal left.window_id right.window_id

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

let shell_safe_char = function
  | 'a' .. 'z'
  | 'A' .. 'Z'
  | '0' .. '9'
  | '_' | '-' | '.' | '/' | ':' | '%' | '=' ->
      true
  | _ -> false

let rec all_shell_safe value idx =
  if idx = String.length value then true
  else if shell_safe_char value.[idx] then all_shell_safe value (idx + 1)
  else false

let shell_display_word value =
  if String.length value > 0 && all_shell_safe value 0 then value
  else quote_shell_word value

let argv = function
  | Has_session session -> [ "has-session"; "-t"; session ]
  | New_detached_session { session; cwd; command } -> (
      let shell_command = shell_command command in
      match cwd with
      | None -> [ "new-session"; "-d"; "-s"; session; shell_command ]
      | Some cwd ->
          [ "new-session"; "-d"; "-s"; session; "-c"; cwd; shell_command ])
  | New_detached_session_with_pane_id { session; cwd; command } -> (
      let shell_command = shell_command command in
      let prefix =
        [ "new-session"; "-d"; "-P"; "-F"; "#{pane_id}"; "-s"; session ]
      in
      match cwd with
      | None -> prefix @ [ shell_command ]
      | Some cwd -> prefix @ [ "-c"; cwd; shell_command ])
  | Split_window { target; cwd; command } -> (
      let shell_command = shell_command command in
      match cwd with
      | None -> [ "split-window"; "-d"; "-t"; target; shell_command ]
      | Some cwd ->
          [ "split-window"; "-d"; "-t"; target; "-c"; cwd; shell_command ])
  | Split_window_with_pane_id { target; cwd; command } -> (
      let shell_command = shell_command command in
      let prefix =
        [ "split-window"; "-d"; "-P"; "-F"; "#{pane_id}"; "-t"; target ]
      in
      match cwd with
      | None -> prefix @ [ shell_command ]
      | Some cwd -> prefix @ [ "-c"; cwd; shell_command ])
  | Select_layout { target; layout } ->
      [ "select-layout"; "-t"; target; layout ]
  | Send_keys { target; text } -> [ "send-keys"; "-t"; target; text; "Enter" ]
  | Send_keys_literal { target; text } ->
      [ "send-keys"; "-l"; "-t"; target; text ]
  | Send_keys_to { target; text } ->
      [ "send-keys"; "-t"; target; text; "Enter" ]
  | Capture_pane { target; lines } ->
      [ "capture-pane"; "-p"; "-t"; target; "-S"; "-" ^ string_of_int lines ]
  | Display_pane_id target ->
      [ "display-message"; "-p"; "-t"; target; "#{pane_id}" ]
  | Display_session_name target ->
      [ "display-message"; "-p"; "-t"; target; "#{session_name}" ]
  | Display_pane_identity target ->
      [ "display-message"; "-p"; "-t"; target; "#{session_id}\t#{window_id}" ]
  | Kill_session session -> [ "kill-session"; "-t"; session ]

let command_line = function
  | Has_session session -> "tmux has-session -t " ^ shell_display_word session
  | New_detached_session { session; cwd; command } ->
      let args =
        [ "tmux"; "new-session"; "-d"; "-s"; shell_display_word session ]
        @
        match cwd with
        | None -> [ shell_command command ]
        | Some cwd -> [ "-c"; shell_display_word cwd; shell_command command ]
      in
      String.concat " " args
  | New_detached_session_with_pane_id { session; cwd; command } ->
      let args =
        [
          "tmux";
          "new-session";
          "-d";
          "-P";
          "-F";
          shell_display_word "#{pane_id}";
          "-s";
          shell_display_word session;
        ]
        @
        match cwd with
        | None -> [ shell_command command ]
        | Some cwd -> [ "-c"; shell_display_word cwd; shell_command command ]
      in
      String.concat " " args
  | Split_window { target; cwd; command } ->
      let args =
        [ "tmux"; "split-window"; "-d"; "-t"; shell_display_word target ]
        @
        match cwd with
        | None -> [ shell_command command ]
        | Some cwd -> [ "-c"; shell_display_word cwd; shell_command command ]
      in
      String.concat " " args
  | Split_window_with_pane_id { target; cwd; command } ->
      let args =
        [
          "tmux";
          "split-window";
          "-d";
          "-P";
          "-F";
          shell_display_word "#{pane_id}";
          "-t";
          shell_display_word target;
        ]
        @
        match cwd with
        | None -> [ shell_command command ]
        | Some cwd -> [ "-c"; shell_display_word cwd; shell_command command ]
      in
      String.concat " " args
  | Select_layout { target; layout } ->
      String.concat " "
        [
          "tmux";
          "select-layout";
          "-t";
          shell_display_word target;
          shell_display_word layout;
        ]
  | Send_keys { target; text } ->
      String.concat " "
        [
          "tmux";
          "send-keys";
          "-t";
          shell_display_word target;
          shell_display_word text;
          "Enter";
        ]
  | Send_keys_literal { target; text } ->
      String.concat " "
        [
          "tmux";
          "send-keys";
          "-l";
          "-t";
          shell_display_word target;
          shell_display_word text;
        ]
  | Send_keys_to { target; text } ->
      String.concat " "
        [
          "tmux";
          "send-keys";
          "-t";
          shell_display_word target;
          shell_display_word text;
          "Enter";
        ]
  | Capture_pane { target; lines } ->
      String.concat " "
        [
          "tmux";
          "capture-pane";
          "-p";
          "-t";
          shell_display_word target;
          "-S";
          "-" ^ string_of_int lines;
        ]
  | Display_pane_id target ->
      String.concat " "
        [
          "tmux";
          "display-message";
          "-p";
          "-t";
          shell_display_word target;
          shell_display_word "#{pane_id}";
        ]
  | Display_session_name target ->
      String.concat " "
        [
          "tmux";
          "display-message";
          "-p";
          "-t";
          shell_display_word target;
          shell_display_word "#{session_name}";
        ]
  | Display_pane_identity target ->
      String.concat " "
        [
          "tmux";
          "display-message";
          "-p";
          "-t";
          shell_display_word target;
          shell_display_word "#{session_id}\t#{window_id}";
        ]
  | Kill_session session -> "tmux kill-session -t " ^ shell_display_word session

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

let remove_noerr path = try Sys.remove path with Sys_error _ -> ()

let run command =
  let args = argv command in
  let argv_array = Array.of_list ("tmux" :: args) in
  let stdout_tmp, stdout_channel = Filename.open_temp_file "ta-tmux" ".out" in
  let stderr_tmp, stderr_channel = Filename.open_temp_file "ta-tmux" ".err" in
  Fun.protect
    ~finally:(fun () ->
      close_out_noerr stdout_channel;
      close_out_noerr stderr_channel;
      remove_noerr stdout_tmp;
      remove_noerr stderr_tmp)
    (fun () ->
      let pid =
        Unix.create_process "tmux" argv_array Unix.stdin
          (Unix.descr_of_out_channel stdout_channel)
          (Unix.descr_of_out_channel stderr_channel)
      in
      let _, status = Unix.waitpid [] pid in
      close_out stdout_channel;
      close_out stderr_channel;
      let stdout_in = open_in stdout_tmp in
      let stderr_in = open_in stderr_tmp in
      Fun.protect
        ~finally:(fun () ->
          close_in_noerr stdout_in;
          close_in_noerr stderr_in)
        (fun () ->
          let output = read_all stdout_in ^ read_all stderr_in in
          match status with
          | Unix.WEXITED 0 -> Ok output
          | status -> Error { argv = "tmux" :: args; status; output }))

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
      let target = unsafe_target_of_string (session_to_string session) in
      let captured = run (Capture_pane { target; lines = 20 }) in
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
