type request = State_summary | State_show of { audit_limit : int }
type response = Success of string | Failure of string

let field name fields =
  match List.assoc_opt name fields with
  | Some value -> Ok value
  | None -> Error ("missing field: " ^ name)

let string_field name fields =
  match field name fields with
  | Ok (`String value) -> Ok value
  | Ok _ -> Error ("field must be a string: " ^ name)
  | Error _ as error -> error

let int_field name fields =
  match field name fields with
  | Ok (`Int value) -> Ok value
  | Ok _ -> Error ("field must be an int: " ^ name)
  | Error _ as error -> error

let request_to_yojson = function
  | State_summary -> `Assoc [ ("command", `String "state-summary") ]
  | State_show { audit_limit } ->
      `Assoc
        [ ("command", `String "state-show"); ("audit_limit", `Int audit_limit) ]

let request_of_yojson = function
  | `Assoc fields -> (
      match string_field "command" fields with
      | Error _ as error -> error
      | Ok "state-summary" -> Ok State_summary
      | Ok "state-show" -> (
          match int_field "audit_limit" fields with
          | Ok audit_limit -> Ok (State_show { audit_limit })
          | Error _ as error -> error)
      | Ok command -> Error ("unknown command: " ^ command))
  | _ -> Error "request must be a JSON object"

let response_to_yojson = function
  | Success output -> `Assoc [ ("ok", `Bool true); ("output", `String output) ]
  | Failure error -> `Assoc [ ("ok", `Bool false); ("error", `String error) ]

let bool_field name fields =
  match field name fields with
  | Ok (`Bool value) -> Ok value
  | Ok _ -> Error ("field must be a bool: " ^ name)
  | Error _ as error -> error

let response_of_yojson = function
  | `Assoc fields -> (
      match bool_field "ok" fields with
      | Error _ as error -> error
      | Ok true -> (
          match string_field "output" fields with
          | Ok output -> Ok (Success output)
          | Error _ as error -> error)
      | Ok false -> (
          match string_field "error" fields with
          | Ok error -> Ok (Failure error)
          | Error _ as error -> error))
  | _ -> Error "response must be a JSON object"

let encode json = Yojson.Safe.to_string json

let decode decode_json value =
  try Yojson.Safe.from_string value |> decode_json
  with Yojson.Json_error message -> Error ("invalid JSON: " ^ message)

let encode_request request = encode (request_to_yojson request)
let decode_request value = decode request_of_yojson value
let encode_response response = encode (response_to_yojson response)
let decode_response value = decode response_of_yojson value
