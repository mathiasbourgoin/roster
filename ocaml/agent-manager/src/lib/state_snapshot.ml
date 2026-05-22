open State_model

type error = { path : string; message : string }

let error path message = { path; message }
let fail path message = Error [ error path message ]
let error_to_string { path; message } = path ^ ": " ^ message
let ( let* ) = Result.bind
let audit_events store = List.rev store.audit_events

let status_to_yojson status =
  let kind, reason =
    match status with
    | Not_started -> ("not-started", None)
    | Starting -> ("starting", None)
    | Running -> ("running", None)
    | Idle -> ("idle", None)
    | Done -> ("done", None)
    | Blocked reason -> ("blocked", Some reason)
    | Failed reason -> ("failed", Some reason)
  in
  let fields = [ ("kind", `String kind) ] in
  let fields =
    match reason with
    | None -> fields
    | Some reason -> ("reason", `String reason) :: fields
  in
  `Assoc (List.rev fields)

let permission_to_yojson permission = `String (Permission.to_string permission)

let agent_to_yojson agent =
  let pane_identity =
    match agent.pane_identity with
    | None -> `Null
    | Some identity ->
        `Assoc
          [
            ("session_id", `String identity.Tmux.session_id);
            ("window_id", `String identity.Tmux.window_id);
          ]
  in
  `Assoc
    [
      ("name", `String (Id.Agent.to_string agent.name));
      ("roster_agent", `String agent.roster_agent);
      ("status", status_to_yojson agent.status);
      ( "pane",
        match agent.pane with
        | None -> `Null
        | Some pane -> `String (Id.Pane.to_string pane) );
      ("pane_identity", pane_identity);
    ]

let link_to_yojson link =
  `Assoc
    [
      ("from", `String (Id.Agent.to_string link.from_agent));
      ("to", `String (Id.Agent.to_string link.to_agent));
      ("permissions", `List (List.map permission_to_yojson link.permissions));
      ("reason", `String link.reason);
    ]

let workspace_to_yojson workspace =
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
        ( "tmux_session",
          match workspace.tmux_session with
          | None -> `Null
          | Some session -> `String (Tmux.session_to_string session) );
        ("active_view", `String (Id.View.to_string workspace.active_view));
        ("agents", `List (List.map agent_to_yojson workspace.agents));
        ("links", `List (List.map link_to_yojson workspace.links));
      ])

let audit_kind_to_yojson = function
  | Workspace_loaded -> `Assoc [ ("kind", `String "workspace-loaded") ]
  | Agent_status_changed { agent; before; after } ->
      `Assoc
        [
          ("kind", `String "agent-status-changed");
          ("agent", `String (Id.Agent.to_string agent));
          ("before", status_to_yojson before);
          ("after", status_to_yojson after);
        ]
  | Pane_attached { agent; pane } ->
      `Assoc
        [
          ("kind", `String "pane-attached");
          ("agent", `String (Id.Agent.to_string agent));
          ("pane", `String (Id.Pane.to_string pane));
        ]

let audit_event_to_yojson event =
  `Assoc
    [
      ("seq", `Int event.seq);
      ("workspace", `String (Id.Workspace.to_string event.workspace));
      ( "actor",
        match event.actor with
        | None -> `Null
        | Some actor -> `String (Id.Agent.to_string actor) );
      ("kind", audit_kind_to_yojson event.kind);
    ]

let to_yojson store =
  `Assoc
    [
      ("version", `String "0.1.0");
      ("next_seq", `Int store.next_seq);
      ("workspaces", `List (List.map workspace_to_yojson store.workspaces));
      ( "audit_events",
        `List (List.map audit_event_to_yojson (audit_events store)) );
    ]

let object_fields path = function
  | `Assoc fields -> Ok fields
  | _ -> fail path "expected object"

let required_field path name fields =
  match List.assoc_opt name fields with
  | Some value -> Ok value
  | None -> fail (path ^ "." ^ name) "missing required field"

let optional_field name fields = List.assoc_opt name fields

let string_at path = function
  | `String value -> Ok value
  | _ -> fail path "expected string"

let int_at path = function
  | `Int value -> Ok value
  | _ -> fail path "expected integer"

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

let parse_id path parse value =
  let* text = string_at path value in
  match parse text with Ok id -> Ok id | Error message -> fail path message

let parse_status path json =
  let* fields = object_fields path json in
  let* kind_json = required_field path "kind" fields in
  let* kind = string_at (path ^ ".kind") kind_json in
  let optional_reason () =
    match optional_field "reason" fields with
    | Some value -> string_at (path ^ ".reason") value
    | None -> fail (path ^ ".reason") "missing required field"
  in
  match kind with
  | "not-started" -> Ok Not_started
  | "starting" -> Ok Starting
  | "running" -> Ok Running
  | "idle" -> Ok Idle
  | "done" -> Ok Done
  | "blocked" ->
      let* reason = optional_reason () in
      Ok (Blocked reason)
  | "failed" ->
      let* reason = optional_reason () in
      Ok (Failed reason)
  | value -> fail (path ^ ".kind") ("unknown status: " ^ value)

let parse_agent path json =
  let* fields = object_fields path json in
  let* name_json = required_field path "name" fields in
  let* name = parse_id (path ^ ".name") Id.Agent.of_string name_json in
  let* roster_agent_json = required_field path "roster_agent" fields in
  let* roster_agent = string_at (path ^ ".roster_agent") roster_agent_json in
  let* status_json = required_field path "status" fields in
  let* status = parse_status (path ^ ".status") status_json in
  let* pane =
    match optional_field "pane" fields with
    | None | Some `Null -> Ok None
    | Some value ->
        let* pane = parse_id (path ^ ".pane") Id.Pane.of_string value in
        Ok (Some pane)
  in
  let* pane_identity =
    match optional_field "pane_identity" fields with
    | None | Some `Null -> Ok None
    | Some value -> (
        let* identity_fields = object_fields (path ^ ".pane_identity") value in
        let* session_id_json =
          required_field (path ^ ".pane_identity") "session_id" identity_fields
        in
        let* session_id =
          string_at (path ^ ".pane_identity.session_id") session_id_json
        in
        let* window_id_json =
          required_field (path ^ ".pane_identity") "window_id" identity_fields
        in
        let* window_id =
          string_at (path ^ ".pane_identity.window_id") window_id_json
        in
        match Tmux.pane_identity_of_strings ~session_id ~window_id with
        | Ok identity -> Ok (Some identity)
        | Error message -> fail (path ^ ".pane_identity") message)
  in
  Ok { name; roster_agent; status; pane; pane_identity }

let parse_permission path json =
  let* text = string_at path json in
  match Permission.of_string text with
  | Ok permission -> Ok permission
  | Error message -> fail path message

let parse_link path json =
  let* fields = object_fields path json in
  let* from_json = required_field path "from" fields in
  let* from_agent = parse_id (path ^ ".from") Id.Agent.of_string from_json in
  let* to_json = required_field path "to" fields in
  let* to_agent = parse_id (path ^ ".to") Id.Agent.of_string to_json in
  let* permissions_json = required_field path "permissions" fields in
  let* permissions =
    list_at (path ^ ".permissions") parse_permission permissions_json
  in
  let* reason_json = required_field path "reason" fields in
  let* reason = string_at (path ^ ".reason") reason_json in
  Ok { from_agent; to_agent; permissions; reason }

let parse_workspace path json =
  let* fields = object_fields path json in
  let* id_json = required_field path "id" fields in
  let* id = parse_id (path ^ ".id") Id.Workspace.of_string id_json in
  let* label_json = required_field path "label" fields in
  let* label = string_at (path ^ ".label") label_json in
  let* root_json = required_field path "root" fields in
  let* root = string_at (path ^ ".root") root_json in
  let* harness_path =
    match optional_field "harness_path" fields with
    | None | Some `Null -> Ok None
    | Some value ->
        let* harness_path = string_at (path ^ ".harness_path") value in
        Ok (Some harness_path)
  in
  let* tmux_session =
    match optional_field "tmux_session" fields with
    | None | Some `Null -> Ok None
    | Some value ->
        let* session =
          parse_id (path ^ ".tmux_session") Tmux.session_of_string value
        in
        Ok (Some session)
  in
  let* active_view_json = required_field path "active_view" fields in
  let* active_view =
    parse_id (path ^ ".active_view") Id.View.of_string active_view_json
  in
  let* agents_json = required_field path "agents" fields in
  let* agents = list_at (path ^ ".agents") parse_agent agents_json in
  let* links_json = required_field path "links" fields in
  let* links = list_at (path ^ ".links") parse_link links_json in
  Ok { id; label; root; harness_path; tmux_session; active_view; agents; links }

let parse_audit_kind path json =
  let* fields = object_fields path json in
  let* kind_json = required_field path "kind" fields in
  let* kind = string_at (path ^ ".kind") kind_json in
  match kind with
  | "workspace-loaded" -> Ok Workspace_loaded
  | "agent-status-changed" ->
      let* agent_json = required_field path "agent" fields in
      let* agent = parse_id (path ^ ".agent") Id.Agent.of_string agent_json in
      let* before_json = required_field path "before" fields in
      let* before = parse_status (path ^ ".before") before_json in
      let* after_json = required_field path "after" fields in
      let* after = parse_status (path ^ ".after") after_json in
      Ok (Agent_status_changed { agent; before; after })
  | "pane-attached" ->
      let* agent_json = required_field path "agent" fields in
      let* agent = parse_id (path ^ ".agent") Id.Agent.of_string agent_json in
      let* pane_json = required_field path "pane" fields in
      let* pane = parse_id (path ^ ".pane") Id.Pane.of_string pane_json in
      Ok (Pane_attached { agent; pane })
  | value -> fail (path ^ ".kind") ("unknown audit kind: " ^ value)

let parse_actor path fields =
  match optional_field "actor" fields with
  | None | Some `Null -> Ok None
  | Some value ->
      let* actor = parse_id (path ^ ".actor") Id.Agent.of_string value in
      Ok (Some actor)

let parse_audit_event path json =
  let* fields = object_fields path json in
  let* seq_json = required_field path "seq" fields in
  let* seq = int_at (path ^ ".seq") seq_json in
  let* workspace_json = required_field path "workspace" fields in
  let* workspace =
    parse_id (path ^ ".workspace") Id.Workspace.of_string workspace_json
  in
  let* actor = parse_actor path fields in
  let* kind_json = required_field path "kind" fields in
  let* kind = parse_audit_kind (path ^ ".kind") kind_json in
  Ok { seq; workspace; actor; kind }

let duplicate_strings values =
  let sorted = List.sort String.compare values in
  let rec loop previous duplicates = function
    | [] -> List.rev duplicates
    | value :: rest -> (
        match previous with
        | Some prev when String.equal prev value ->
            loop (Some value) (value :: duplicates) rest
        | _ -> loop (Some value) duplicates rest)
  in
  loop None [] sorted

let validate_links workspace =
  let agent_ids =
    List.map (fun agent -> Id.Agent.to_string agent.name) workspace.agents
  in
  match duplicate_strings agent_ids with
  | duplicate :: _ ->
      fail "$.workspaces.agents" ("duplicate agent id: " ^ duplicate)
  | [] ->
      workspace.links
      |> List.fold_left
           (fun acc link ->
             match acc with
             | Error _ as error -> error
             | Ok () ->
                 let from_agent = Id.Agent.to_string link.from_agent in
                 let to_agent = Id.Agent.to_string link.to_agent in
                 if link.permissions = [] then
                   fail "$.workspaces.links"
                     "link permissions must not be empty"
                 else if not (List.exists (String.equal from_agent) agent_ids)
                 then
                   fail "$.workspaces.links"
                     ("link source agent does not exist: " ^ from_agent)
                 else if not (List.exists (String.equal to_agent) agent_ids)
                 then
                   fail "$.workspaces.links"
                     ("link target agent does not exist: " ^ to_agent)
                 else Ok ())
           (Ok ())

let validate_event store event =
  let workspace_id = Id.Workspace.to_string event.workspace in
  match
    List.find_opt
      (fun workspace -> Id.Workspace.equal workspace.id event.workspace)
      store.workspaces
  with
  | None ->
      fail "$.audit_events" ("event workspace does not exist: " ^ workspace_id)
  | Some workspace -> (
      let agent_ids =
        List.map (fun agent -> Id.Agent.to_string agent.name) workspace.agents
      in
      let agent_exists agent =
        List.exists (String.equal (Id.Agent.to_string agent)) agent_ids
      in
      let* () =
        match event.actor with
        | None -> Ok ()
        | Some actor ->
            if agent_exists actor then Ok ()
            else
              fail "$.audit_events.actor"
                ("event actor does not exist: " ^ Id.Agent.to_string actor)
      in
      match event.kind with
      | Workspace_loaded -> Ok ()
      | Agent_status_changed { agent; _ } | Pane_attached { agent; _ } ->
          if agent_exists agent then Ok ()
          else
            fail "$.audit_events.kind.agent"
              ("event agent does not exist: " ^ Id.Agent.to_string agent))

let validate_snapshot_graph store =
  let workspace_ids =
    List.map
      (fun workspace -> Id.Workspace.to_string workspace.id)
      store.workspaces
  in
  match duplicate_strings workspace_ids with
  | duplicate :: _ ->
      fail "$.workspaces" ("duplicate workspace id: " ^ duplicate)
  | [] ->
      let* () =
        store.workspaces
        |> List.fold_left
             (fun acc workspace ->
               match acc with
               | Error _ as error -> error
               | Ok () -> validate_links workspace)
             (Ok ())
      in
      store.audit_events
      |> List.fold_left
           (fun acc event ->
             match acc with
             | Error _ as error -> error
             | Ok () -> validate_event store event)
           (Ok ())

let validate_snapshot_sequences store =
  if store.next_seq < 1 then fail "$.next_seq" "next_seq must be positive"
  else
    let events = audit_events store in
    let rec loop expected previous = function
      | [] ->
          let expected_next = previous + 1 in
          if store.next_seq <> expected_next then
            fail "$.next_seq"
              ("expected next_seq "
              ^ string_of_int expected_next
              ^ ", got "
              ^ string_of_int store.next_seq)
          else Ok ()
      | event :: rest ->
          if event.seq <> expected then
            fail "$.audit_events"
              ("expected audit seq " ^ string_of_int expected ^ ", got "
             ^ string_of_int event.seq)
          else loop (expected + 1) event.seq rest
    in
    loop 1 0 events

let validate_snapshot store =
  let* () = validate_snapshot_sequences store in
  validate_snapshot_graph store

let of_yojson json =
  let* fields = object_fields "$" json in
  let* version_json = required_field "$" "version" fields in
  let* version = string_at "$.version" version_json in
  if not (String.equal version "0.1.0") then
    fail "$.version" ("unsupported snapshot version: " ^ version)
  else
    let* next_seq_json = required_field "$" "next_seq" fields in
    let* next_seq = int_at "$.next_seq" next_seq_json in
    let* workspaces_json = required_field "$" "workspaces" fields in
    let* workspaces = list_at "$.workspaces" parse_workspace workspaces_json in
    let* events_json = required_field "$" "audit_events" fields in
    let* events = list_at "$.audit_events" parse_audit_event events_json in
    let store = { workspaces; audit_events = List.rev events; next_seq } in
    let* () = validate_snapshot store in
    Ok store
