type error =
  | Io of { path : string; message : string }
  | Json of { path : string; message : string }
  | Snapshot of { path : string; errors : State_store.snapshot_error list }

let io path message = Io { path; message }
let json path message = Json { path; message }
let remove_noerr path = try Sys.remove path with Sys_error _ -> ()

let save ~path store =
  try
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
        Yojson.Safe.to_file temp_path (State_store.to_yojson store);
        Sys.rename temp_path path;
        committed := true);
    Ok ()
  with
  | Sys_error message -> Error (io path message)
  | Unix.Unix_error (error, _, _) -> Error (io path (Unix.error_message error))
  | Invalid_argument message -> Error (io path message)

let load ~path =
  try
    let snapshot = Yojson.Safe.from_file path in
    match State_store.of_yojson snapshot with
    | Ok store -> Ok store
    | Error errors -> Error (Snapshot { path; errors })
  with
  | Sys_error message -> Error (io path message)
  | Yojson.Json_error message -> Error (json path message)
  | Unix.Unix_error (error, _, _) -> Error (io path (Unix.error_message error))

let error_to_string = function
  | Io { path; message } -> path ^ ": " ^ message
  | Json { path; message } -> path ^ ": invalid JSON: " ^ message
  | Snapshot { path; errors } ->
      String.concat "\n"
        (List.map
           (fun error ->
             path ^ ": " ^ State_store.snapshot_error_to_string error)
           errors)
