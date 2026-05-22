let config =
  {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "fixture",
      "label": "Fixture",
      "root": ".",
      "tmux_session": "ta-fixture",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]},
        {"name": "qa", "roster_agent": "qa", "command": ["codex"]}
      ],
      "links": [
        {"from": "lead", "to": "qa", "permissions": ["read"], "reason": "delegate QA"}
      ]
    }
  ]
}
|}

let lead = Ta_core.Id.Agent.unsafe_of_string "lead"

let parse_config () =
  match Ta_core.Workspace_config.parse_string config with
  | Ok config -> config
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let store () =
  match Ta_core.State_store.of_config (parse_config ()) with
  | Ok store -> store
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))

let snapshot_json () =
  let snapshot =
    match
      Ta_core.Dashboard_snapshot.of_state_for_actor ~now:42.0 ~lines:5
        (store ()) ~actor:lead
    with
    | Ok snapshot -> snapshot
    | Error message -> Alcotest.fail message
  in
  snapshot |> Ta_core.Dashboard_snapshot.to_yojson |> Yojson.Safe.to_string

let expect_request socket_path lines = function
  | Ta_core.Socket_protocol.Dashboard_snapshot { actor; lines = requested } ->
      Alcotest.(check string) "socket" "/tmp/ta.sock" socket_path;
      Alcotest.(check string) "actor" "lead" (Ta_core.Id.Agent.to_string actor);
      Alcotest.(check int) "lines" lines requested
  | _ -> Alcotest.fail "expected dashboard-snapshot request"

let expect_fetch_model_success () =
  let request_socket ~socket_path request =
    expect_request socket_path 5 request;
    Ok (Ta_core.Socket_protocol.Success (snapshot_json ()))
  in
  match
    Ta_core.Dashboard_socket_refresh.fetch_model ~request_socket
      ~socket_path:"/tmp/ta.sock" ~actor:lead ~lines:5 ()
  with
  | Error error ->
      Alcotest.fail (Ta_core.Dashboard_socket_refresh.error_to_string error)
  | Ok model ->
      Alcotest.(check int)
        "agents" 2 model.Ta_core.Dashboard_model.totals.agent_count

let expect_failure_response () =
  let request_socket ~socket_path request =
    expect_request socket_path 5 request;
    Ok (Ta_core.Socket_protocol.Failure "permission denied")
  in
  match
    Ta_core.Dashboard_socket_refresh.fetch_model ~request_socket
      ~socket_path:"/tmp/ta.sock" ~actor:lead ~lines:5 ()
  with
  | Ok _ -> Alcotest.fail "expected failure"
  | Error error ->
      Alcotest.(check string)
        "error" "permission denied"
        (Ta_core.Dashboard_socket_refresh.error_to_string error)

let expect_invalid_json () =
  let request_socket ~socket_path request =
    expect_request socket_path 5 request;
    Ok (Ta_core.Socket_protocol.Success "{")
  in
  match
    Ta_core.Dashboard_socket_refresh.fetch_model ~request_socket
      ~socket_path:"/tmp/ta.sock" ~actor:lead ~lines:5 ()
  with
  | Ok _ -> Alcotest.fail "expected invalid json"
  | Error error ->
      Alcotest.(check bool)
        "json error" true
        (String.starts_with ~prefix:"invalid dashboard snapshot JSON:"
           (Ta_core.Dashboard_socket_refresh.error_to_string error))

let expect_decode_error () =
  let request_socket ~socket_path request =
    expect_request socket_path 5 request;
    Ok
      (Ta_core.Socket_protocol.Success
         {|{"version":"9.9.9","state":{},"runtime":{}}|})
  in
  match
    Ta_core.Dashboard_socket_refresh.fetch_model ~request_socket
      ~socket_path:"/tmp/ta.sock" ~actor:lead ~lines:5 ()
  with
  | Ok _ -> Alcotest.fail "expected decode error"
  | Error error ->
      Alcotest.(check string)
        "decode" "unsupported dashboard snapshot version: 9.9.9"
        (Ta_core.Dashboard_socket_refresh.error_to_string error)

let () =
  Alcotest.run "dashboard-socket-refresh"
    [
      ( "dashboard_socket_refresh",
        [
          Alcotest.test_case "fetch model success" `Quick
            expect_fetch_model_success;
          Alcotest.test_case "failure response" `Quick expect_failure_response;
          Alcotest.test_case "invalid json" `Quick expect_invalid_json;
          Alcotest.test_case "decode error" `Quick expect_decode_error;
        ] );
    ]
