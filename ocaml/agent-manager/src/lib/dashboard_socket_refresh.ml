type error =
  | Socket of Socket_api.error
  | Failure of string
  | Invalid_json of string
  | Snapshot_decode of string

let error_to_string = function
  | Socket error -> Socket_api.error_to_string error
  | Failure message -> message
  | Invalid_json message -> "invalid dashboard snapshot JSON: " ^ message
  | Snapshot_decode message -> message

let fetch_snapshot ?(request_socket = Socket_api.request) ~socket_path ~actor
    ~lines () =
  let request = Socket_protocol.Dashboard_snapshot { actor; lines } in
  match request_socket ~socket_path request with
  | Error error -> Error (Socket error)
  | Ok (Socket_protocol.Failure message) -> Error (Failure message)
  | Ok (Socket_protocol.Success output) -> (
      match
        output |> Yojson.Safe.from_string |> Dashboard_snapshot.of_yojson
      with
      | Ok snapshot -> Ok snapshot
      | Error message -> Error (Snapshot_decode message)
      | exception Yojson.Json_error message -> Error (Invalid_json message))

let fetch_model ?request_socket ~socket_path ~actor ~lines () =
  match fetch_snapshot ?request_socket ~socket_path ~actor ~lines () with
  | Ok snapshot -> Ok (Dashboard_snapshot.to_dashboard_model snapshot)
  | Error _ as error -> error
