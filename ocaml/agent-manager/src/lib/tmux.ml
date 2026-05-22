type session = string
type target = string

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
  | Split_window of {
      target : target;
      cwd : string option;
      command : string list;
    }
  | Select_layout of { target : target; layout : string }
  | Send_keys of { target : session; text : string }
  | Send_keys_literal of { target : target; text : string }
  | Send_keys_to of { target : target; text : string }
  | Capture_pane of { target : session; lines : int }
  | Display_pane_id of target
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
  | Split_window { target; cwd; command } -> (
      let shell_command = shell_command command in
      match cwd with
      | None -> [ "split-window"; "-d"; "-t"; target; shell_command ]
      | Some cwd ->
          [ "split-window"; "-d"; "-t"; target; "-c"; cwd; shell_command ])
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
  | Split_window { target; cwd; command } ->
      let args =
        [ "tmux"; "split-window"; "-d"; "-t"; shell_display_word target ]
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
