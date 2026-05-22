type pane_state = Unattached | Live | Missing of string

type agent = {
  workspace : Id.Workspace.t;
  name : Id.Agent.t;
  roster_agent : string;
  configured_status : State_store.agent_status;
  expected_session : Tmux.session option;
  pane : Id.Pane.t option;
  pane_identity : Tmux.pane_identity option;
  pane_state : pane_state;
  preview : string list;
}

type workspace = { id : Id.Workspace.t; agents : agent list }
type t = { captured_at : float; workspaces : workspace list }

let max_preview_lines = 200
let max_preview_line_bytes = 4_096
let max_preview_bytes = 65_536
let truncation_marker = "... [truncated]"

let truncate_to limit value =
  if String.length value <= limit then value
  else
    let marker_length = String.length truncation_marker in
    if limit <= 0 then ""
    else if limit <= marker_length then String.sub truncation_marker 0 limit
    else String.sub value 0 (limit - marker_length) ^ truncation_marker

let cap_preview_lines lines =
  let rec loop remaining acc = function
    | [] -> List.rev acc
    | _ when remaining <= 0 -> List.rev acc
    | line :: rest ->
        let line = truncate_to max_preview_line_bytes line in
        if String.length line <= remaining then
          loop (remaining - String.length line) (line :: acc) rest
        else List.rev (truncate_to remaining line :: acc)
  in
  loop max_preview_bytes [] lines

let split_lines value =
  let length = String.length value in
  let rec trim_leading_blank = function
    | [] -> []
    | line :: rest when String.trim line = "" -> trim_leading_blank rest
    | lines -> lines
  in
  let trim_trailing_blank lines =
    lines |> List.rev |> trim_leading_blank |> List.rev
  in
  let rec loop start idx acc =
    if idx = length then
      let acc =
        if start = idx then acc else String.sub value start (idx - start) :: acc
      in
      List.rev acc |> trim_trailing_blank
    else if Char.equal value.[idx] '\n' then
      let line = String.sub value start (idx - start) in
      loop (idx + 1) (idx + 1) (line :: acc)
    else loop start (idx + 1) acc
  in
  loop 0 0 []

let validate_identity runner target expected_identity =
  match runner (Tmux.Display_pane_identity target) with
  | Error error -> Error (Tmux.error_to_string error)
  | Ok output -> (
      match Tmux.parse_pane_identity output with
      | Error message -> Error message
      | Ok actual ->
          if Tmux.equal_pane_identity actual expected_identity then Ok ()
          else
            Error
              (Printf.sprintf
                 "pane identity changed: session_id=%s window_id=%s, expected \
                  session_id=%s window_id=%s"
                 actual.session_id actual.window_id expected_identity.session_id
                 expected_identity.window_id))

let capture_pane runner lines pane_identity pane =
  let target = Tmux.unsafe_target_of_string (Id.Pane.to_string pane) in
  match pane_identity with
  | None -> (Missing "agent pane has no tmux identity; cannot verify pane", [])
  | Some pane_identity -> (
      match validate_identity runner target pane_identity with
      | Error message -> (Missing message, [])
      | Ok () -> (
          match runner (Tmux.Capture_pane { target; lines }) with
          | Ok output -> (Live, output |> split_lines |> cap_preview_lines)
          | Error error -> (Missing (Tmux.error_to_string error), [])))

let observe_agent runner lines workspace_id expected_session
    (agent : State_store.agent) =
  let pane_state, preview =
    match agent.pane with
    | None -> (Unattached, [])
    | Some pane -> capture_pane runner lines agent.pane_identity pane
  in
  {
    workspace = workspace_id;
    name = agent.name;
    roster_agent = agent.roster_agent;
    configured_status = agent.status;
    expected_session;
    pane = agent.pane;
    pane_identity = agent.pane_identity;
    pane_state;
    preview;
  }

let collect_workspace runner lines (workspace : State_store.workspace) =
  {
    id = workspace.id;
    agents =
      List.map
        (observe_agent runner lines workspace.id workspace.tmux_session)
        workspace.agents;
  }

let collect ?(now = Unix.gettimeofday ()) ?(lines = 20) ?(runner = Tmux.run)
    store =
  let lines = max 1 (min max_preview_lines lines) in
  {
    captured_at = now;
    workspaces =
      State_store.workspaces store |> List.map (collect_workspace runner lines);
  }

let collect_agent ?(now = Unix.gettimeofday ()) ?(lines = 20)
    ?(runner = Tmux.run) store ~workspace ~agent =
  let lines = max 1 (min max_preview_lines lines) in
  let ( let* ) = Result.bind in
  let* workspace_state = State_store.find_workspace store workspace in
  let* agent_state = State_store.find_agent workspace_state agent in
  Ok
    {
      captured_at = now;
      workspaces =
        [
          {
            id = workspace_state.id;
            agents =
              [
                observe_agent runner lines workspace_state.id
                  workspace_state.tmux_session agent_state;
              ];
          };
        ];
    }

let pane_state_to_yojson = function
  | Unattached -> `Assoc [ ("kind", `String "unattached") ]
  | Live -> `Assoc [ ("kind", `String "live") ]
  | Missing message ->
      `Assoc [ ("kind", `String "missing"); ("message", `String message) ]

let pane_to_yojson = function
  | None -> `Null
  | Some pane -> `String (Id.Pane.to_string pane)

let pane_identity_to_yojson = function
  | None -> `Null
  | Some identity ->
      `Assoc
        [
          ("session_id", `String identity.Tmux.session_id);
          ("window_id", `String identity.Tmux.window_id);
        ]

let agent_to_yojson agent =
  `Assoc
    [
      ("workspace", `String (Id.Workspace.to_string agent.workspace));
      ("name", `String (Id.Agent.to_string agent.name));
      ("roster_agent", `String agent.roster_agent);
      ( "configured_status",
        `String (State_store.status_to_string agent.configured_status) );
      ( "expected_session",
        match agent.expected_session with
        | None -> `Null
        | Some session -> `String (Tmux.session_to_string session) );
      ("pane", pane_to_yojson agent.pane);
      ("pane_identity", pane_identity_to_yojson agent.pane_identity);
      ("pane_state", pane_state_to_yojson agent.pane_state);
      ("preview", `List (List.map (fun line -> `String line) agent.preview));
    ]

let workspace_to_yojson workspace =
  `Assoc
    [
      ("id", `String (Id.Workspace.to_string workspace.id));
      ("agents", `List (List.map agent_to_yojson workspace.agents));
    ]

let to_yojson snapshot =
  `Assoc
    [
      ("version", `String "0.1.0");
      ("captured_at", `Float snapshot.captured_at);
      ("workspaces", `List (List.map workspace_to_yojson snapshot.workspaces));
    ]

let count_agents snapshot =
  List.fold_left
    (fun count workspace -> count + List.length workspace.agents)
    0 snapshot.workspaces

let count_live snapshot =
  List.fold_left
    (fun count workspace ->
      count
      + List.fold_left
          (fun count agent ->
            match agent.pane_state with Live -> count + 1 | _ -> count)
          0 workspace.agents)
    0 snapshot.workspaces

let summarize snapshot =
  Printf.sprintf
    "TA runtime snapshot: %d workspace(s), %d agent(s), %d live pane(s)"
    (List.length snapshot.workspaces)
    (count_agents snapshot) (count_live snapshot)
