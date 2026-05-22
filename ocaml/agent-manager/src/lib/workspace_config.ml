type error = { path : string; message : string }
type view = { id : Id.View.t; label : string }

type agent = {
  name : Id.Agent.t;
  roster_agent : string;
  command : string list;
  cwd : string option;
  env : (string * string) list;
  capabilities : Agent_capability.t list;
  startup_prompt : string option;
}

type link = {
  from_agent : Id.Agent.t;
  to_agent : Id.Agent.t;
  permissions : Permission.t list;
  reason : string;
}

type workspace = {
  id : Id.Workspace.t;
  label : string;
  root : string;
  harness_path : string option;
  tmux_session : Tmux.session;
  default_view : Id.View.t;
  views : view list;
  agents : agent list;
  links : link list;
}

type t = { version : string; workspaces : workspace list }

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

let optional_list_field path name fields parse =
  match optional_field name fields with
  | None -> Ok []
  | Some value -> list_at (path ^ "." ^ name) parse value

let id_at path parse value =
  let* text = string_at path value in
  match parse text with Ok id -> Ok id | Error message -> fail path message

let workspace_id_at path value = id_at path Id.Workspace.of_string value
let agent_id_at path value = id_at path Id.Agent.of_string value
let view_id_at path value = id_at path Id.View.of_string value

let tmux_session_at path value =
  let* text = string_at path value in
  match Tmux.session_of_string text with
  | Ok session -> Ok session
  | Error message -> fail path message

let parse_env_binding path json =
  let* fields = object_fields path json in
  let* name = string_field path "name" fields in
  let* value = string_field path "value" fields in
  Ok (name, value)

let parse_view path json =
  let* fields = object_fields path json in
  let* id_json = field path "id" fields in
  let* id = view_id_at (path ^ ".id") id_json in
  let* label = string_field path "label" fields in
  Ok { id; label }

let parse_agent path json =
  let* fields = object_fields path json in
  let* name_json = field path "name" fields in
  let* name = agent_id_at (path ^ ".name") name_json in
  let* roster_agent = string_field path "roster_agent" fields in
  let* command =
    list_field path "command" fields (fun item_path value ->
        string_at item_path value)
  in
  let* cwd = optional_string_field path "cwd" fields in
  let* env = optional_list_field path "env" fields parse_env_binding in
  let* capabilities =
    optional_list_field path "capabilities" fields (fun item_path value ->
        let* text = string_at item_path value in
        match Agent_capability.of_string text with
        | Ok capability -> Ok capability
        | Error message -> fail item_path message)
  in
  let* startup_prompt = optional_string_field path "startup_prompt" fields in
  Ok { name; roster_agent; command; cwd; env; capabilities; startup_prompt }

let parse_permission path json =
  let* text = string_at path json in
  match Permission.of_string text with
  | Ok permission -> Ok permission
  | Error message -> fail path message

let parse_link path json =
  let* fields = object_fields path json in
  let* from_json = field path "from" fields in
  let* from_agent = agent_id_at (path ^ ".from") from_json in
  let* to_json = field path "to" fields in
  let* to_agent = agent_id_at (path ^ ".to") to_json in
  let* permissions = list_field path "permissions" fields parse_permission in
  let* reason = string_field path "reason" fields in
  Ok { from_agent; to_agent; permissions; reason }

let parse_workspace path json =
  let* fields = object_fields path json in
  let* id_json = field path "id" fields in
  let* id = workspace_id_at (path ^ ".id") id_json in
  let* label = string_field path "label" fields in
  let* root = string_field path "root" fields in
  let* harness_path = optional_string_field path "harness_path" fields in
  let* tmux_session_json = field path "tmux_session" fields in
  let* tmux_session =
    tmux_session_at (path ^ ".tmux_session") tmux_session_json
  in
  let* default_view_json = field path "default_view" fields in
  let* default_view = view_id_at (path ^ ".default_view") default_view_json in
  let* views = list_field path "views" fields parse_view in
  let* agents = list_field path "agents" fields parse_agent in
  let* links = optional_list_field path "links" fields parse_link in
  Ok
    {
      id;
      label;
      root;
      harness_path;
      tmux_session;
      default_view;
      views;
      agents;
      links;
    }

let parse_json json =
  let path = "$" in
  let* fields = object_fields path json in
  let* version = string_field path "version" fields in
  let* workspaces = list_field path "workspaces" fields parse_workspace in
  Ok { version; workspaces }

let parse_string text =
  match Yojson.Safe.from_string text with
  | json -> parse_json json
  | exception Yojson.Json_error message -> fail "$" ("invalid JSON: " ^ message)

let load path =
  match open_in path with
  | exception Sys_error message -> fail path message
  | channel ->
      Fun.protect
        ~finally:(fun () -> close_in_noerr channel)
        (fun () ->
          let buffer = Buffer.create 4096 in
          let bytes = Bytes.create 4096 in
          let rec read_loop () =
            match input channel bytes 0 (Bytes.length bytes) with
            | 0 -> Buffer.contents buffer
            | read ->
                Buffer.add_subbytes buffer bytes 0 read;
                read_loop ()
          in
          match read_loop () with
          | text -> parse_string text
          | exception Sys_error message -> fail path message)

let binding_to_yojson (name, value) =
  `Assoc [ ("name", `String name); ("value", `String value) ]

let view_to_yojson (view : view) =
  `Assoc
    [
      ("id", `String (Id.View.to_string view.id));
      ("label", `String view.label);
    ]

let agent_to_yojson (agent : agent) =
  let optional name value =
    match value with None -> [] | Some value -> [ (name, `String value) ]
  in
  `Assoc
    ([
       ("name", `String (Id.Agent.to_string agent.name));
       ("roster_agent", `String agent.roster_agent);
       ("command", `List (List.map (fun value -> `String value) agent.command));
     ]
    @ optional "cwd" agent.cwd
    @ (match agent.env with
      | [] -> []
      | env -> [ ("env", `List (List.map binding_to_yojson env)) ])
    @ (match agent.capabilities with
      | [] -> []
      | capabilities ->
          [
            ( "capabilities",
              `List
                (List.map
                   (fun capability ->
                     `String (Agent_capability.to_string capability))
                   capabilities) );
          ])
    @ optional "startup_prompt" agent.startup_prompt)

let link_to_yojson (link : link) =
  `Assoc
    [
      ("from", `String (Id.Agent.to_string link.from_agent));
      ("to", `String (Id.Agent.to_string link.to_agent));
      ( "permissions",
        `List
          (List.map
             (fun permission -> `String (Permission.to_string permission))
             link.permissions) );
      ("reason", `String link.reason);
    ]

let workspace_to_yojson (workspace : workspace) =
  let harness_path =
    match workspace.harness_path with
    | None -> []
    | Some path -> [ ("harness_path", `String path) ]
  in
  `Assoc
    ([
       ("id", `String (Id.Workspace.to_string workspace.id));
       ("label", `String workspace.label);
       ("root", `String workspace.root);
     ]
    @ harness_path
    @ [
        ("tmux_session", `String (Tmux.session_to_string workspace.tmux_session));
        ("default_view", `String (Id.View.to_string workspace.default_view));
        ("views", `List (List.map view_to_yojson workspace.views));
        ("agents", `List (List.map agent_to_yojson workspace.agents));
        ("links", `List (List.map link_to_yojson workspace.links));
      ])

let to_yojson config =
  `Assoc
    [
      ("version", `String config.version);
      ("workspaces", `List (List.map workspace_to_yojson config.workspaces));
    ]

let to_string config = Yojson.Safe.pretty_to_string (to_yojson config)

let duplicate_strings values =
  let sorted = List.sort String.compare values in
  let rec loop duplicates previous = function
    | [] -> List.rev duplicates
    | value :: rest -> (
        match previous with
        | Some prev when String.equal prev value ->
            loop (value :: duplicates) (Some value) rest
        | _ -> loop duplicates (Some value) rest)
  in
  loop [] None sorted

let agent_name_strings (workspace : workspace) =
  List.map
    (fun (agent : agent) -> Id.Agent.to_string agent.name)
    workspace.agents

let view_id_strings (workspace : workspace) =
  List.map (fun (view : view) -> Id.View.to_string view.id) workspace.views

let has_string value values = List.exists (String.equal value) values

let validate_workspace ?roster index workspace =
  let base = "$.workspaces[" ^ string_of_int index ^ "]" in
  let agent_names = agent_name_strings workspace in
  let view_ids = view_id_strings workspace in
  let duplicate_agents =
    duplicate_strings agent_names
    |> List.map (fun value ->
        error (base ^ ".agents") ("duplicate agent id: " ^ value))
  in
  let duplicate_views =
    duplicate_strings view_ids
    |> List.map (fun value ->
        error (base ^ ".views") ("duplicate view id: " ^ value))
  in
  let default_view = Id.View.to_string workspace.default_view in
  let default_view_error =
    if has_string default_view view_ids then []
    else
      [
        error (base ^ ".default_view")
          ("default view does not exist: " ^ default_view);
      ]
  in
  let empty_command_errors =
    workspace.agents
    |> List.filter (fun agent -> agent.command = [])
    |> List.map (fun agent ->
        error
          (base ^ ".agents." ^ Id.Agent.to_string agent.name ^ ".command")
          "command must not be empty")
  in
  let roster_errors =
    match roster with
    | None -> []
    | Some roster ->
        workspace.agents
        |> List.filter (fun agent ->
            not (Roster_index.mem_agent roster agent.roster_agent))
        |> List.map (fun agent ->
            error
              (base ^ ".agents."
              ^ Id.Agent.to_string agent.name
              ^ ".roster_agent")
              ("unknown roster agent: " ^ agent.roster_agent))
  in
  let link_errors =
    workspace.links
    |> List.concat_map (fun link ->
        let from_name = Id.Agent.to_string link.from_agent in
        let to_name = Id.Agent.to_string link.to_agent in
        let unknown_from =
          if has_string from_name agent_names then []
          else
            [
              error (base ^ ".links")
                ("link source agent does not exist: " ^ from_name);
            ]
        in
        let unknown_to =
          if has_string to_name agent_names then []
          else
            [
              error (base ^ ".links")
                ("link target agent does not exist: " ^ to_name);
            ]
        in
        let empty_permissions =
          if link.permissions = [] then
            [ error (base ^ ".links") "link permissions must not be empty" ]
          else []
        in
        unknown_from @ unknown_to @ empty_permissions)
  in
  duplicate_agents @ duplicate_views @ default_view_error @ empty_command_errors
  @ roster_errors @ link_errors

let validate_with ?roster config =
  let workspace_ids =
    List.map
      (fun workspace -> Id.Workspace.to_string workspace.id)
      config.workspaces
  in
  let duplicate_workspaces =
    duplicate_strings workspace_ids
    |> List.map (fun value ->
        error "$.workspaces" ("duplicate workspace id: " ^ value))
  in
  let workspace_errors =
    config.workspaces |> List.mapi (validate_workspace ?roster) |> List.concat
  in
  duplicate_workspaces @ workspace_errors

let validate config = validate_with config
let validate_with_roster ~roster config = validate_with ~roster config

let summarize_workspace (workspace : workspace) =
  Printf.sprintf "- %s: %d agents, %d views, %d links, tmux=%s"
    (Id.Workspace.to_string workspace.id)
    (List.length workspace.agents)
    (List.length workspace.views)
    (List.length workspace.links)
    (Tmux.session_to_string workspace.tmux_session)

let summarize config =
  let header =
    Printf.sprintf "TA config v%s: %d workspace(s)" config.version
      (List.length config.workspaces)
  in
  String.concat "\n" (header :: List.map summarize_workspace config.workspaces)
