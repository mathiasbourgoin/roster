type read
type write
type runtime_state = Unknown | Unattached | Live | Missing of string

type endpoint = {
  workspace : Id.Workspace.t;
  agent : Id.Agent.t;
  tmux_session : Tmux.session option;
  pane : Id.Pane.t option;
  state : runtime_state;
  preview_lines : int;
}

type target = { endpoint : endpoint; readable : bool; writable : bool }

type _ socket_intent =
  | Runtime_snapshot : {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      lines : int;
    }
      -> read socket_intent
  | Future_agent_message : {
      workspace : Id.Workspace.t;
      from_agent : Id.Agent.t;
      to_agent : Id.Agent.t;
    }
      -> write socket_intent
  | Focus_pane : {
      workspace : Id.Workspace.t;
      agent : Id.Agent.t;
      pane : Id.Pane.t option;
    }
      -> read socket_intent

type action = Action : 'cap socket_intent * string -> action

type t = {
  edge : Dashboard_topology.edge_id;
  source : endpoint;
  targets : target list;
  actions : action list;
}

let fit width value =
  let length = String.length value in
  if width <= 0 then ""
  else if length = width then value
  else if length < width then value ^ String.make (width - length) ' '
  else if width <= 3 then String.sub value 0 width
  else String.sub value 0 (width - 3) ^ "..."

let runtime_state_to_string = function
  | Unknown -> "STALE"
  | Unattached -> "DETACHED"
  | Live -> "LIVE"
  | Missing _ -> "MISSING"

let pane_to_string = function
  | None -> "-"
  | Some pane -> Id.Pane.to_string pane

let session_to_string = function
  | None -> "-"
  | Some session -> Tmux.session_to_string session

let endpoint_ref endpoint =
  Printf.sprintf "%s/%s"
    (Id.Workspace.to_string endpoint.workspace)
    (Id.Agent.to_string endpoint.agent)

let socket_intent_to_string : type cap. cap socket_intent -> string = function
  | Runtime_snapshot { workspace; agent; lines } ->
      Printf.sprintf "runtime-snapshot %s/%s lines %d"
        (Id.Workspace.to_string workspace)
        (Id.Agent.to_string agent) lines
  | Future_agent_message { workspace; from_agent; to_agent } ->
      Printf.sprintf "future-agent-message %s/%s -> %s"
        (Id.Workspace.to_string workspace)
        (Id.Agent.to_string from_agent)
        (Id.Agent.to_string to_agent)
  | Focus_pane { workspace; agent; pane } ->
      Printf.sprintf "focus-pane %s/%s pane %s"
        (Id.Workspace.to_string workspace)
        (Id.Agent.to_string agent) (pane_to_string pane)

let action_to_string (Action (intent, label)) =
  Printf.sprintf "%s | %s" label (socket_intent_to_string intent)

let runtime_state_to_yojson = function
  | Unknown -> `Assoc [ ("kind", `String "unknown") ]
  | Unattached -> `Assoc [ ("kind", `String "unattached") ]
  | Live -> `Assoc [ ("kind", `String "live") ]
  | Missing message ->
      `Assoc [ ("kind", `String "missing"); ("message", `String message) ]

let pane_to_yojson = function
  | None -> `Null
  | Some pane -> `String (Id.Pane.to_string pane)

let session_to_yojson = function
  | None -> `Null
  | Some session -> `String (Tmux.session_to_string session)

let endpoint_to_yojson endpoint =
  `Assoc
    [
      ("workspace", `String (Id.Workspace.to_string endpoint.workspace));
      ("agent", `String (Id.Agent.to_string endpoint.agent));
      ("tmux_session", session_to_yojson endpoint.tmux_session);
      ("pane", pane_to_yojson endpoint.pane);
      ("runtime_state", runtime_state_to_yojson endpoint.state);
      ("preview_lines", `Int endpoint.preview_lines);
    ]

let target_to_yojson ?(selected = false) target =
  `Assoc
    [
      ("endpoint", endpoint_to_yojson target.endpoint);
      ("readable", `Bool target.readable);
      ("writable", `Bool target.writable);
      ("selected", `Bool selected);
    ]

let is_selected_target selected target =
  match selected with
  | None -> false
  | Some selected -> Id.Agent.equal selected target.endpoint.agent

let socket_intent_to_yojson : type cap. cap socket_intent -> Yojson.Safe.t =
  function
  | Runtime_snapshot { workspace; agent; lines } ->
      `Assoc
        [
          ("kind", `String "runtime-snapshot");
          ("workspace", `String (Id.Workspace.to_string workspace));
          ("agent", `String (Id.Agent.to_string agent));
          ("lines", `Int lines);
        ]
  | Future_agent_message { workspace; from_agent; to_agent } ->
      `Assoc
        [
          ("kind", `String "future-agent-message");
          ("workspace", `String (Id.Workspace.to_string workspace));
          ("from_agent", `String (Id.Agent.to_string from_agent));
          ("to_agent", `String (Id.Agent.to_string to_agent));
        ]
  | Focus_pane { workspace; agent; pane } ->
      `Assoc
        [
          ("kind", `String "focus-pane");
          ("workspace", `String (Id.Workspace.to_string workspace));
          ("agent", `String (Id.Agent.to_string agent));
          ("pane", pane_to_yojson pane);
        ]

let socket_intent_capability : type cap. cap socket_intent -> string = function
  | Runtime_snapshot _ | Focus_pane _ -> "read"
  | Future_agent_message _ -> "write"

let action_to_yojson (Action (intent, label)) =
  `Assoc
    [
      ("label", `String label);
      ("capability", `String (socket_intent_capability intent));
      ("intent", socket_intent_to_yojson intent);
    ]

let edge_id_to_yojson edge =
  `Assoc
    [
      ( "workspace",
        `String
          (Id.Workspace.to_string (Dashboard_topology.edge_workspace edge)) );
      ( "from_agent",
        `String (Id.Agent.to_string (Dashboard_topology.edge_from_agent edge))
      );
    ]

let to_yojson ?selected_target affordance =
  `Assoc
    [
      ("edge", edge_id_to_yojson affordance.edge);
      ("source", endpoint_to_yojson affordance.source);
      ( "targets",
        `List
          (List.map
             (fun target ->
               target_to_yojson
                 ~selected:(is_selected_target selected_target target)
                 target)
             affordance.targets) );
      ("actions", `List (List.map action_to_yojson affordance.actions));
    ]

let target_permissions target =
  match (target.readable, target.writable) with
  | false, false -> "-"
  | true, false -> "read"
  | false, true -> "write"
  | true, true -> "read,write"

let target_ref target = endpoint_ref target.endpoint

let endpoint_line label endpoint =
  Printf.sprintf "%s %s pane %s session %s runtime %s preview-lines %d" label
    (endpoint_ref endpoint)
    (pane_to_string endpoint.pane)
    (session_to_string endpoint.tmux_session)
    (runtime_state_to_string endpoint.state)
    endpoint.preview_lines

let target_line selected target =
  Printf.sprintf "%s Edge target: %s permissions %s"
    (if is_selected_target selected target then ">" else " ")
    (endpoint_line "" target.endpoint |> String.trim)
    (target_permissions target)

let render_preview ?selected_target ~width affordance =
  let target_refs =
    match affordance.targets with
    | [] -> "-"
    | targets -> targets |> List.map target_ref |> String.concat ","
  in
  [
    "Focused edge: " ^ endpoint_ref affordance.source ^ " -> " ^ target_refs;
    endpoint_line "Edge source:" affordance.source;
  ]
  @ List.map (target_line selected_target) affordance.targets
  @ List.map
      (fun action -> "Action: " ^ action_to_string action)
      affordance.actions
  |> List.map (fit width)
