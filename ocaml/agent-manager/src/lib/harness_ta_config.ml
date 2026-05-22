type error = { path : string; message : string }
type harness_agent = { name : Id.Agent.t; role : string option }

let default_harness_path = ".harness/harness.json"
let default_output_path = ".harness/ta.json"
let error path message = { path; message }
let fail path message = Error [ error path message ]
let ( let* ) = Result.bind
let error_to_string { path; message } = path ^ ": " ^ message

let object_fields path = function
  | `Assoc fields -> Ok fields
  | _ -> fail path "expected object"

let field path name fields =
  match List.assoc_opt name fields with
  | Some value -> Ok value
  | None -> fail (path ^ "." ^ name) "missing required field"

let optional_field name fields = List.assoc_opt name fields

let string_at path = function
  | `String value -> Ok value
  | _ -> fail path "expected string"

let string_field path name fields =
  let* value = field path name fields in
  string_at (path ^ "." ^ name) value

let optional_string_field path name fields =
  match optional_field name fields with
  | None -> Ok None
  | Some value ->
      let* parsed = string_at (path ^ "." ^ name) value in
      Ok (Some parsed)

let list_at path parse = function
  | `List values ->
      let rec loop idx acc = function
        | [] -> Ok (List.rev acc)
        | value :: rest -> (
            match parse (path ^ "[" ^ string_of_int idx ^ "]") value with
            | Ok parsed -> loop (idx + 1) (parsed :: acc) rest
            | Error errors -> Error errors)
      in
      loop 0 [] values
  | _ -> fail path "expected list"

let list_field path name fields parse =
  let* value = field path name fields in
  list_at (path ^ "." ^ name) parse value

let agent_id_at path value =
  let* text = string_at path value in
  match Id.Agent.of_string text with
  | Ok id -> Ok id
  | Error message -> fail path message

let parse_agent path json =
  let* fields = object_fields path json in
  let* name_json = field path "name" fields in
  let* name = agent_id_at (path ^ ".name") name_json in
  let* role = optional_string_field path "role" fields in
  Ok { name; role }

let sanitize_name value =
  let buffer = Buffer.create (String.length value) in
  let previous_dash = ref false in
  let add_dash () =
    if Buffer.length buffer > 0 && not !previous_dash then (
      Buffer.add_char buffer '-';
      previous_dash := true)
  in
  String.iter
    (function
      | 'A' .. 'Z' as char ->
          Buffer.add_char buffer (Char.lowercase_ascii char);
          previous_dash := false
      | ('a' .. 'z' | '0' .. '9' | '_' | '-' | '.') as char ->
          Buffer.add_char buffer char;
          previous_dash := Char.equal char '-'
      | _ -> add_dash ())
    value;
  let sanitized = Buffer.contents buffer in
  let sanitized = String.trim sanitized in
  if String.equal sanitized "" then "workspace" else sanitized

let workspace_id_of_project name =
  match Id.Workspace.of_string (sanitize_name name) with
  | Ok id -> Ok id
  | Error message -> fail "$.project.name" message

let view_agents = Id.View.unsafe_of_string "agents"

let agent_priority (agent : harness_agent) =
  match Id.Agent.to_string agent.name with
  | "tech-lead" -> 0
  | "recruiter" -> 1
  | _ -> 2

let order_agents agents =
  agents
  |> List.mapi (fun index agent -> (agent_priority agent, index, agent))
  |> List.sort
       (fun (left_priority, left_index, _)
            (right_priority, right_index, _) ->
         match Int.compare left_priority right_priority with
         | 0 -> Int.compare left_index right_index
         | order -> order)
  |> List.map (fun (_, _, agent) -> agent)

let startup_prompt (agent : harness_agent) =
  match agent.role with
  | None ->
      Some ("Run as " ^ Id.Agent.to_string agent.name ^ " for this TA workspace.")
  | Some role -> Some ("Run as " ^ Id.Agent.to_string agent.name ^ ": " ^ role)

let capability_authorities = [ "tech-lead"; "recruiter" ]

let capabilities_for_agent (agent : harness_agent) =
  if
    List.exists
      (String.equal (Id.Agent.to_string agent.name))
      capability_authorities
  then [ Agent_capability.Create_agent; Agent_capability.Connect_agents ]
  else []

let config_agent (agent : harness_agent) =
  let name = Id.Agent.to_string agent.name in
  {
    Workspace_config.name = agent.name;
    roster_agent = name;
    command = [ "codex" ];
    cwd = Some ".";
    env = [ ("TA_ROLE", name) ];
    capabilities = capabilities_for_agent agent;
    startup_prompt = startup_prompt agent;
  }

let coordinator_names = [ "tech-lead"; "recruiter" ]

let coordinator_agents agents =
  agents
  |> List.filter (fun agent ->
         List.exists
           (String.equal (Id.Agent.to_string agent.name))
           coordinator_names)

let link_from_coordinator coordinator target =
  {
    Workspace_config.from_agent = coordinator.name;
    to_agent = target.name;
    permissions = [ Permission.Read; Permission.Write ];
    reason =
      Id.Agent.to_string coordinator.name
      ^ " coordinates harness agent "
      ^ Id.Agent.to_string target.name;
  }

let generated_links agents =
  let coordinators = coordinator_agents agents in
  coordinators
  |> List.concat_map (fun coordinator ->
         agents
         |> List.filter (fun target ->
                not (Id.Agent.equal coordinator.name target.name))
         |> List.map (link_from_coordinator coordinator))

let root_for_output output_path =
  match Filename.basename (Filename.dirname output_path) with
  | ".harness" -> ".."
  | _ -> "."

let workspace_config ~harness_path ~output_path project_name agents =
  let* id = workspace_id_of_project project_name in
  let session =
    Tmux.unsafe_session_of_string ("ta-" ^ Id.Workspace.to_string id)
  in
  let agents = order_agents agents in
  let workspace =
    {
      Workspace_config.id;
      label = project_name;
      root = root_for_output output_path;
      harness_path = Some harness_path;
      tmux_session = session;
      default_view = view_agents;
      views = [ { id = view_agents; label = "Agents" } ];
      agents = List.map config_agent agents;
      links = generated_links agents;
    }
  in
  Ok { Workspace_config.version = "0.1.0"; workspaces = [ workspace ] }

let parse_json ~harness_path ~output_path json =
  let* fields = object_fields "$" json in
  let* project_json = field "$" "project" fields in
  let* project_fields = object_fields "$.project" project_json in
  let* project_name = string_field "$.project" "name" project_fields in
  let* layers_json = field "$" "layers" fields in
  let* layers_fields = object_fields "$.layers" layers_json in
  let* agents = list_field "$.layers" "agents" layers_fields parse_agent in
  match agents with
  | [] -> fail "$.layers.agents" "at least one harness agent is required"
  | _ -> workspace_config ~harness_path ~output_path project_name agents

let parse_string ~harness_path ~output_path text =
  match Yojson.Safe.from_string text with
  | json -> (
      match parse_json ~harness_path ~output_path json with
      | Error _ as error -> error
      | Ok config -> (
          match Workspace_config.validate config with
          | [] -> Ok config
          | errors ->
              Error
                (List.map
                   (fun (error : Workspace_config.error) ->
                     { path = error.path; message = error.message })
                   errors)))
  | exception Yojson.Json_error message -> fail "$" ("invalid JSON: " ^ message)

let read_file path =
  match open_in path with
  | exception Sys_error message -> Error [ error path message ]
  | channel ->
      Fun.protect
        ~finally:(fun () -> close_in_noerr channel)
        (fun () ->
          let buffer = Buffer.create 4096 in
          let bytes = Bytes.create 4096 in
          let rec loop () =
            match input channel bytes 0 (Bytes.length bytes) with
            | 0 -> Ok (Buffer.contents buffer)
            | read ->
                Buffer.add_subbytes buffer bytes 0 read;
                loop ()
          in
          match loop () with
          | Ok _ as ok -> ok
          | Error _ as error -> error
          | exception Sys_error message -> Error [ error path message ])

let load ~harness_path ~output_path =
  let* text = read_file harness_path in
  parse_string ~harness_path ~output_path text

let ensure_parent_dir path =
  let dir = Filename.dirname path in
  if String.equal dir "." then Ok ()
  else
    try
      let stats = Unix.stat dir in
      match stats.Unix.st_kind with
      | Unix.S_DIR -> Ok ()
      | _ -> Error (dir ^ ": parent path is not a directory")
    with
    | Unix.Unix_error (Unix.ENOENT, _, _) -> (
        try Unix.mkdir dir 0o700; Ok ()
        with Unix.Unix_error (error, _, _) ->
          Error (dir ^ ": " ^ Unix.error_message error))
    | Sys_error message -> Error (dir ^ ": " ^ message)
    | Unix.Unix_error (error, _, _) ->
        Error (dir ^ ": " ^ Unix.error_message error)

let write_file path contents =
  let* () = ensure_parent_dir path in
  match open_out path with
  | exception Sys_error message -> Error message
  | channel ->
      Fun.protect
        ~finally:(fun () -> close_out_noerr channel)
        (fun () ->
          match output_string channel contents with
          | () -> Ok ()
          | exception Sys_error message -> Error message)

let generate_file ~harness_path ~output_path =
  if Sys.file_exists output_path then Ok output_path
  else
    match load ~harness_path ~output_path with
    | Error errors ->
        Error (String.concat "\n" (List.map error_to_string errors))
    | Ok config -> (
        match
          write_file output_path (Workspace_config.to_string config ^ "\n")
        with
        | Error message -> Error (output_path ^ ": " ^ message)
        | Ok () -> Ok output_path)
