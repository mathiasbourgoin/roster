type request =
  | State_summary
  | State_show of { audit_limit : int }
  | Runtime_snapshot of {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      actor : Id.Agent.t;
      lines : int;
    }
  | Set_status of {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      status : State_store.agent_status;
      actor : Id.Agent.t option;
    }
  | Attach_pane of {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      pane : Id.Pane.t;
      actor : Id.Agent.t option;
    }
  | Launch_dry_run of { config_path : string; roster_index : string option }
  | Launch_start of {
      config_path : string;
      roster_index : string option;
      actor : Id.Agent.t;
    }

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

let optional_string_field name fields =
  match List.assoc_opt name fields with
  | None | Some `Null -> Ok None
  | Some (`String value) -> Ok (Some value)
  | Some _ -> Error ("field must be a string or null: " ^ name)

let id_field name parse fields =
  match string_field name fields with
  | Error _ as error -> error
  | Ok value -> (
      match parse value with
      | Ok id -> Ok id
      | Error message -> Error (name ^ ": " ^ message))

let actor_field fields =
  match optional_string_field "actor" fields with
  | Error _ as error -> error
  | Ok None -> Ok None
  | Ok (Some value) -> (
      match Id.Agent.of_string value with
      | Ok actor -> Ok (Some actor)
      | Error message -> Error ("actor: " ^ message))

let status_fields status =
  match status with
  | State_store.Blocked reason -> ("blocked", Some reason)
  | State_store.Failed reason -> ("failed", Some reason)
  | status -> (State_store.status_to_string status, None)

let optional_assoc name = function
  | None -> []
  | Some value -> [ (name, `String value) ]

let actor_to_yojson = function
  | None -> `Null
  | Some actor -> `String (Id.Agent.to_string actor)

let string_option_to_yojson = function
  | None -> `Null
  | Some value -> `String value

let request_to_yojson = function
  | State_summary -> `Assoc [ ("command", `String "state-summary") ]
  | State_show { audit_limit } ->
      `Assoc
        [ ("command", `String "state-show"); ("audit_limit", `Int audit_limit) ]
  | Runtime_snapshot { workspace; agent; actor; lines } ->
      `Assoc
        [
          ("command", `String "runtime-snapshot");
          ("workspace", `String (Id.Workspace.to_string workspace));
          ("agent", `String (Id.Agent.to_string agent));
          ("actor", `String (Id.Agent.to_string actor));
          ("lines", `Int lines);
        ]
  | Set_status { workspace; agent; status; actor } ->
      let status, reason = status_fields status in
      `Assoc
        ([
           ("command", `String "set-status");
           ("workspace", `String (Id.Workspace.to_string workspace));
           ("agent", `String (Id.Agent.to_string agent));
           ("status", `String status);
           ("actor", actor_to_yojson actor);
         ]
        @ optional_assoc "reason" reason)
  | Attach_pane { workspace; agent; pane; actor } ->
      `Assoc
        [
          ("command", `String "attach-pane");
          ("workspace", `String (Id.Workspace.to_string workspace));
          ("agent", `String (Id.Agent.to_string agent));
          ("pane", `String (Id.Pane.to_string pane));
          ("actor", actor_to_yojson actor);
        ]
  | Launch_dry_run { config_path; roster_index } ->
      `Assoc
        [
          ("command", `String "launch-dry-run");
          ("config", `String config_path);
          ("roster_index", string_option_to_yojson roster_index);
        ]
  | Launch_start { config_path; roster_index; actor } ->
      `Assoc
        [
          ("command", `String "launch-start");
          ("config", `String config_path);
          ("roster_index", string_option_to_yojson roster_index);
          ("actor", `String (Id.Agent.to_string actor));
        ]

let launch_fields fields =
  let ( let* ) = Result.bind in
  let* config_path = string_field "config" fields in
  let* roster_index = optional_string_field "roster_index" fields in
  Ok (config_path, roster_index)

let required_actor_field command fields =
  match actor_field fields with
  | Ok (Some actor) -> Ok actor
  | Ok None -> Error ("actor is required for " ^ command)
  | Error _ as error -> error

let set_status_of_fields fields =
  let ( let* ) = Result.bind in
  let* workspace = id_field "workspace" Id.Workspace.of_string fields in
  let* agent = id_field "agent" Id.Agent.of_string fields in
  let* status_name = string_field "status" fields in
  let* reason = optional_string_field "reason" fields in
  let* status = State_store.status_of_string ?reason status_name in
  let* actor = actor_field fields in
  Ok (Set_status { workspace; agent; status; actor })

let attach_pane_of_fields fields =
  let ( let* ) = Result.bind in
  let* workspace = id_field "workspace" Id.Workspace.of_string fields in
  let* agent = id_field "agent" Id.Agent.of_string fields in
  let* pane = id_field "pane" Id.Pane.of_string fields in
  let* actor = actor_field fields in
  Ok (Attach_pane { workspace; agent; pane; actor })

let runtime_snapshot_of_fields fields =
  let ( let* ) = Result.bind in
  let* workspace = id_field "workspace" Id.Workspace.of_string fields in
  let* agent = id_field "agent" Id.Agent.of_string fields in
  let* lines = int_field "lines" fields in
  let* actor = required_actor_field "runtime-snapshot" fields in
  Ok (Runtime_snapshot { workspace; agent; actor; lines })

let request_of_yojson = function
  | `Assoc fields -> (
      match string_field "command" fields with
      | Error _ as error -> error
      | Ok "state-summary" -> Ok State_summary
      | Ok "state-show" -> (
          match int_field "audit_limit" fields with
          | Ok audit_limit -> Ok (State_show { audit_limit })
          | Error _ as error -> error)
      | Ok "runtime-snapshot" -> runtime_snapshot_of_fields fields
      | Ok "set-status" -> set_status_of_fields fields
      | Ok "attach-pane" -> attach_pane_of_fields fields
      | Ok "launch-dry-run" -> (
          match launch_fields fields with
          | Ok (config_path, roster_index) ->
              Ok (Launch_dry_run { config_path; roster_index })
          | Error _ as error -> error)
      | Ok "launch-start" -> (
          match launch_fields fields with
          | Ok (config_path, roster_index) -> (
              match required_actor_field "launch-start" fields with
              | Ok actor ->
                  Ok (Launch_start { config_path; roster_index; actor })
              | Error _ as error -> error)
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
