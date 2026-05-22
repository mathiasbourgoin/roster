type t = { state : State_store.t; runtime : Runtime_snapshot.t }

let max_dashboard_preview_bytes = 262_144
let truncation_marker = "... [truncated]"

let truncate_to limit value =
  if String.length value <= limit then value
  else
    let marker_length = String.length truncation_marker in
    if limit <= 0 then ""
    else if limit <= marker_length then String.sub truncation_marker 0 limit
    else String.sub value 0 (limit - marker_length) ^ truncation_marker

let agent_can_read store workspace actor (agent : State_store.agent) =
  Id.Agent.equal actor agent.name
  || State_store.can_access store ~workspace ~from_agent:actor
       ~to_agent:agent.name Permission.Read

let actor_exists workspace actor =
  match State_store.find_agent workspace actor with
  | Ok _ -> true
  | Error _ -> false

let visible_agent_names store actor workspace =
  workspace.State_store.agents
  |> List.filter (agent_can_read store workspace.State_store.id actor)
  |> List.map (fun (agent : State_store.agent) -> agent.name)

let agent_name_visible names agent = List.exists (Id.Agent.equal agent) names

let link_visible names (link : State_store.link) =
  agent_name_visible names link.from_agent
  && agent_name_visible names link.to_agent

let redact_workspace store actor workspace =
  if not (actor_exists workspace actor) then None
  else
    let visible_names = visible_agent_names store actor workspace in
    let agents =
      workspace.State_store.agents
      |> List.filter (fun (agent : State_store.agent) ->
          agent_name_visible visible_names agent.name)
    in
    let links = List.filter (link_visible visible_names) workspace.links in
    Some { workspace with agents; links }

let redacted_state_for_actor store actor =
  State_store.action_visible_to_actor store ~actor

let collect_agent ?now ~lines ~runner store workspace agent =
  let ( let* ) = Result.bind in
  let* snapshot =
    Runtime_snapshot.collect_agent ?now ~lines ~runner store
      ~workspace:workspace.State_store.id ~agent:agent.State_store.name
  in
  match snapshot.Runtime_snapshot.workspaces with
  | [ { Runtime_snapshot.agents = [ agent ]; _ } ] -> Ok agent
  | _ -> Error "unexpected runtime snapshot shape"

let collect_workspace ?now ~lines ~runner store actor workspace =
  match redact_workspace store actor workspace with
  | None -> Ok (false, None)
  | Some visible_workspace ->
      let ( let* ) = Result.bind in
      let rec loop acc = function
        | [] ->
            Ok
              ( true,
                Some
                  { Runtime_snapshot.id = workspace.id; agents = List.rev acc }
              )
        | agent :: rest ->
            let* runtime_agent =
              collect_agent ?now ~lines ~runner store workspace agent
            in
            loop (runtime_agent :: acc) rest
      in
      loop [] visible_workspace.agents

let runtime_for_actor ?(now = Unix.gettimeofday ()) ~lines ~runner state ~actor
    =
  let rec loop actor_seen acc = function
    | [] ->
        if actor_seen then
          Ok { Runtime_snapshot.captured_at = now; workspaces = List.rev acc }
        else Error ("unknown actor: " ^ Id.Agent.to_string actor)
    | workspace :: rest -> (
        match collect_workspace ~now ~lines ~runner state actor workspace with
        | Error _ as error -> error
        | Ok (seen, None) -> loop (actor_seen || seen) acc rest
        | Ok (seen, Some runtime_workspace) ->
            loop (actor_seen || seen) (runtime_workspace :: acc) rest)
  in
  loop false [] (State_store.workspaces state)

let cap_lines budget lines =
  let rec loop remaining acc = function
    | [] -> (remaining, List.rev acc)
    | _ when remaining <= 0 -> (0, List.rev acc)
    | line :: rest ->
        let line_length = String.length line in
        if line_length <= remaining then
          loop (remaining - line_length) (line :: acc) rest
        else
          let line = truncate_to remaining line in
          (0, List.rev (line :: acc))
  in
  loop (max 0 budget) [] lines

let cap_runtime_agent budget (agent : Runtime_snapshot.agent) =
  let remaining, preview = cap_lines budget agent.preview in
  (remaining, { agent with preview })

let cap_runtime_workspace budget (workspace : Runtime_snapshot.workspace) =
  let remaining, agents =
    List.fold_left
      (fun (remaining, agents) agent ->
        let remaining, agent = cap_runtime_agent remaining agent in
        (remaining, agent :: agents))
      (budget, []) workspace.agents
  in
  (remaining, { workspace with agents = List.rev agents })

let cap_runtime_previews budget runtime =
  let _remaining, workspaces =
    List.fold_left
      (fun (remaining, workspaces) workspace ->
        let remaining, workspace = cap_runtime_workspace remaining workspace in
        (remaining, workspace :: workspaces))
      (max 0 budget, [])
      runtime.Runtime_snapshot.workspaces
  in
  { runtime with workspaces = List.rev workspaces }

let with_preview_byte_budget budget snapshot =
  { snapshot with runtime = cap_runtime_previews budget snapshot.runtime }

let to_yojson snapshot =
  `Assoc
    [
      ("version", `String "0.1.0");
      ("state", State_store.to_yojson snapshot.state);
      ("runtime", Runtime_snapshot.to_yojson snapshot.runtime);
    ]

let to_json_string snapshot = Yojson.Safe.to_string (to_yojson snapshot)

let to_bounded_yojson_string ~max_bytes ~encoded_length snapshot =
  if max_bytes < 1 then Error "dashboard snapshot byte limit must be positive"
  else
    let output = to_json_string snapshot in
    if encoded_length output <= max_bytes then Ok output
    else
      let rec loop budget =
        let snapshot = with_preview_byte_budget budget snapshot in
        let output = to_json_string snapshot in
        if encoded_length output <= max_bytes then Ok output
        else if budget = 0 then
          Error
            (Printf.sprintf
               "dashboard snapshot exceeds socket response limit (%d bytes)"
               max_bytes)
        else loop (budget / 2)
      in
      loop max_dashboard_preview_bytes

let of_state_for_actor ?(now = Unix.gettimeofday ()) ?(lines = 20)
    ?(runner = Tmux.run) state ~actor =
  let ( let* ) = Result.bind in
  let lines = max 1 (min Runtime_snapshot.max_preview_lines lines) in
  let* state = redacted_state_for_actor state actor in
  let* runtime = runtime_for_actor ~now ~lines ~runner state ~actor in
  Ok { state; runtime }

let field name fields =
  match List.assoc_opt name fields with
  | Some value -> Ok value
  | None -> Error ("missing field: " ^ name)

let string_field name fields =
  match field name fields with
  | Ok (`String value) -> Ok value
  | Ok _ -> Error ("field must be a string: " ^ name)
  | Error _ as error -> error

let float_field name fields =
  match field name fields with
  | Ok (`Float value) -> Ok value
  | Ok (`Int value) -> Ok (float_of_int value)
  | Ok _ -> Error ("field must be a number: " ^ name)
  | Error _ as error -> error

let list_field name fields =
  match field name fields with
  | Ok (`List values) -> Ok values
  | Ok _ -> Error ("field must be a list: " ^ name)
  | Error _ as error -> error

let object_fields label = function
  | `Assoc fields -> Ok fields
  | _ -> Error ("expected object: " ^ label)

let optional_string_field name fields =
  match List.assoc_opt name fields with
  | None | Some `Null -> Ok None
  | Some (`String value) -> Ok (Some value)
  | Some _ -> Error ("field must be a string or null: " ^ name)

let parse_id name parse fields =
  let ( let* ) = Result.bind in
  let* value = string_field name fields in
  match parse value with
  | Ok id -> Ok id
  | Error message -> Error (name ^ ": " ^ message)

let parse_optional_pane fields =
  match optional_string_field "pane" fields with
  | Error _ as error -> error
  | Ok None -> Ok None
  | Ok (Some value) -> (
      match Id.Pane.of_string value with
      | Ok pane -> Ok (Some pane)
      | Error message -> Error ("pane: " ^ message))

let parse_pane_identity fields =
  let ( let* ) = Result.bind in
  match List.assoc_opt "pane_identity" fields with
  | None | Some `Null -> Ok None
  | Some value -> (
      let* fields = object_fields "pane_identity" value in
      let* session_id = string_field "session_id" fields in
      let* window_id = string_field "window_id" fields in
      match Tmux.pane_identity_of_strings ~session_id ~window_id with
      | Ok identity -> Ok (Some identity)
      | Error message -> Error ("pane_identity: " ^ message))

let parse_pane_state fields =
  let ( let* ) = Result.bind in
  let* json = field "pane_state" fields in
  let* fields = object_fields "pane_state" json in
  let* kind = string_field "kind" fields in
  match kind with
  | "unattached" -> Ok Runtime_snapshot.Unattached
  | "live" -> Ok Runtime_snapshot.Live
  | "missing" ->
      let* message = string_field "message" fields in
      Ok (Runtime_snapshot.Missing message)
  | value -> Error ("unknown pane_state kind: " ^ value)

let parse_preview fields =
  let ( let* ) = Result.bind in
  let* lines = list_field "preview" fields in
  let rec loop acc = function
    | [] -> Ok (List.rev acc)
    | `String line :: rest -> loop (line :: acc) rest
    | _ :: _ -> Error "preview lines must be strings"
  in
  loop [] lines

let parse_runtime_agent json =
  let ( let* ) = Result.bind in
  let* fields = object_fields "runtime agent" json in
  let* workspace = parse_id "workspace" Id.Workspace.of_string fields in
  let* name = parse_id "name" Id.Agent.of_string fields in
  let* roster_agent = string_field "roster_agent" fields in
  let* pane = parse_optional_pane fields in
  let* pane_identity = parse_pane_identity fields in
  let* pane_state = parse_pane_state fields in
  let* preview = parse_preview fields in
  Ok
    {
      Runtime_snapshot.workspace;
      name;
      roster_agent;
      configured_status = State_store.Not_started;
      expected_session = None;
      pane;
      pane_identity;
      pane_state;
      preview;
    }

let parse_runtime_workspace json =
  let ( let* ) = Result.bind in
  let* fields = object_fields "runtime workspace" json in
  let* id = parse_id "id" Id.Workspace.of_string fields in
  let* agents_json = list_field "agents" fields in
  let rec loop acc = function
    | [] -> Ok { Runtime_snapshot.id; agents = List.rev acc }
    | agent :: rest ->
        let* agent = parse_runtime_agent agent in
        loop (agent :: acc) rest
  in
  loop [] agents_json

let parse_runtime json =
  let ( let* ) = Result.bind in
  let* fields = object_fields "runtime" json in
  let* captured_at = float_field "captured_at" fields in
  let* workspaces_json = list_field "workspaces" fields in
  let rec loop acc = function
    | [] -> Ok { Runtime_snapshot.captured_at; workspaces = List.rev acc }
    | workspace :: rest ->
        let* workspace = parse_runtime_workspace workspace in
        loop (workspace :: acc) rest
  in
  loop [] workspaces_json

let of_yojson json =
  let ( let* ) = Result.bind in
  let* fields = object_fields "dashboard snapshot" json in
  let* version = string_field "version" fields in
  if not (String.equal version "0.1.0") then
    Error ("unsupported dashboard snapshot version: " ^ version)
  else
    let* state_json = field "state" fields in
    let* state =
      match State_store.of_yojson state_json with
      | Ok state -> Ok state
      | Error errors ->
          Error
            (errors
            |> List.map State_store.snapshot_error_to_string
            |> String.concat "\n")
    in
    let* runtime_json = field "runtime" fields in
    let* runtime = parse_runtime runtime_json in
    Ok { state; runtime }

let to_dashboard_model snapshot =
  Dashboard_model.of_state_runtime snapshot.state snapshot.runtime
