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

let is_selected_target selected target =
  match selected with
  | None -> false
  | Some selected -> Id.Agent.equal selected target.endpoint.agent

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
