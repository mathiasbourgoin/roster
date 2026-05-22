let config =
  {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "fixture",
      "label": "Fixture Workspace",
      "root": ".",
      "tmux_session": "ta-fixture",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]},
        {"name": "qa", "roster_agent": "qa", "command": ["codex"]}
      ]
    }
  ]
}
|}

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

let dashboard_at now =
  let store = store () in
  let runtime = Ta_core.Runtime_snapshot.collect ~now store in
  Ta_core.Dashboard_model.of_state_runtime store runtime

let seconds value =
  match Ta_core.Dashboard_refresh_cadence.seconds value with
  | Ok value -> value
  | Error message -> Alcotest.fail message

let timestamp value =
  match Ta_core.Dashboard_refresh_cadence.timestamp value with
  | Ok value -> value
  | Error message -> Alcotest.fail message

let policy () =
  match
    Ta_core.Dashboard_refresh_cadence.policy ~refresh_interval:(seconds 5.0)
      ~stale_after:(seconds 15.0) ~min_retry_interval:(seconds 2.0)
  with
  | Ok policy -> policy
  | Error message -> Alcotest.fail message

let as_agent option =
  Option.map Ta_core.Id.Agent.to_string option |> Option.value ~default:"-"

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let expect_first_tick_refreshes () =
  let calls = ref 0 in
  let refresh () =
    incr calls;
    Ok (dashboard_at 10.0)
  in
  let state =
    Ta_core.Dashboard_runner.init ~policy:(policy ()) (dashboard_at 0.0)
  in
  let step =
    Ta_core.Dashboard_runner.step ~refresh state
      (Ta_core.Dashboard_runner.tick_event (timestamp 10.0))
  in
  Alcotest.(check int) "refresh calls" 1 !calls;
  Alcotest.(check bool)
    "success" true
    (match step.outcome with
    | Ta_core.Dashboard_runner.Refresh_succeeded Never_refreshed -> true
    | No_refresh | Refresh_succeeded _ | Refresh_failed _ -> false);
  Alcotest.(check bool)
    "success recorded" true
    (Option.is_some
       (Ta_core.Dashboard_refresh_cadence.last_success_at
          (Ta_core.Dashboard_runner.cadence step.state)))

let expect_tick_waits_until_interval () =
  let calls = ref 0 in
  let refresh () =
    incr calls;
    Ok (dashboard_at 10.0)
  in
  let state =
    Ta_core.Dashboard_runner.init ~policy:(policy ()) (dashboard_at 0.0)
  in
  let state =
    (Ta_core.Dashboard_runner.step ~refresh state
       (Ta_core.Dashboard_runner.tick_event (timestamp 10.0)))
      .state
  in
  let step =
    Ta_core.Dashboard_runner.step ~refresh state
      (Ta_core.Dashboard_runner.tick_event (timestamp 12.0))
  in
  Alcotest.(check int) "refresh calls" 1 !calls;
  Alcotest.(check bool)
    "wait" true
    (match step.outcome with
    | Ta_core.Dashboard_runner.No_refresh -> true
    | Refresh_succeeded _ | Refresh_failed _ -> false)

let expect_manual_refresh_preserves_selection () =
  let calls = ref 0 in
  let refresh () =
    incr calls;
    Ok (dashboard_at 11.0)
  in
  let state =
    Ta_core.Dashboard_runner.init ~policy:(policy ()) (dashboard_at 0.0)
  in
  let down = Ta_core.Dashboard_runner.key_event ~at:(timestamp 10.0) "Down" in
  let manual = Ta_core.Dashboard_runner.key_event ~at:(timestamp 11.0) "r" in
  let state = Ta_core.Dashboard_runner.run ~refresh state [ down ] in
  let step = Ta_core.Dashboard_runner.step ~refresh state manual in
  Alcotest.(check int) "refresh calls" 1 !calls;
  Alcotest.(check bool)
    "manual" true
    (match step.outcome with
    | Ta_core.Dashboard_runner.Refresh_succeeded Manual -> true
    | No_refresh | Refresh_succeeded _ | Refresh_failed _ -> false);
  Alcotest.(check string)
    "agent preserved" "qa"
    (as_agent
       (Ta_core.Dashboard_interaction.selected_agent
          (Ta_core.Dashboard_runner.interaction step.state)))

let expect_refresh_failure_marks_stale () =
  let refresh () = Error "socket unavailable" in
  let state =
    Ta_core.Dashboard_runner.init ~policy:(policy ()) (dashboard_at 0.0)
  in
  let step =
    Ta_core.Dashboard_runner.step ~refresh state
      (Ta_core.Dashboard_runner.tick_event (timestamp 10.0))
  in
  Alcotest.(check bool)
    "failure" true
    (match step.outcome with
    | Ta_core.Dashboard_runner.Refresh_failed
        (Never_refreshed, "socket unavailable") ->
        true
    | No_refresh | Refresh_succeeded _ | Refresh_failed _ -> false);
  Alcotest.(check bool)
    "failure recorded" true
    (Ta_core.Dashboard_refresh_cadence.failure_count
       (Ta_core.Dashboard_runner.cadence step.state)
    = 1);
  let rendered =
    Ta_core.Dashboard_runner.render ~now:(timestamp 12.0) ~width:90 step.state
  in
  Alcotest.(check bool)
    "stale banner" true
    (contains_substring ~needle:"Refresh: STALE - socket unavailable" rendered)

let expect_quit_suppresses_refresh () =
  let calls = ref 0 in
  let refresh () =
    incr calls;
    Ok (dashboard_at 10.0)
  in
  let state =
    Ta_core.Dashboard_runner.init ~policy:(policy ()) (dashboard_at 0.0)
  in
  let quit = Ta_core.Dashboard_runner.key_event ~at:(timestamp 10.0) "q" in
  let state = Ta_core.Dashboard_runner.run ~refresh state [ quit ] in
  let step =
    Ta_core.Dashboard_runner.step ~refresh state
      (Ta_core.Dashboard_runner.tick_event (timestamp 20.0))
  in
  Alcotest.(check bool) "quit" true (Ta_core.Dashboard_runner.should_quit state);
  Alcotest.(check int) "refresh calls" 0 !calls;
  Alcotest.(check bool)
    "no refresh" true
    (match step.outcome with
    | Ta_core.Dashboard_runner.No_refresh -> true
    | Refresh_succeeded _ | Refresh_failed _ -> false)

let expect_render_includes_cadence () =
  let refresh () = Ok (dashboard_at 10.0) in
  let state =
    Ta_core.Dashboard_runner.init ~policy:(policy ()) (dashboard_at 0.0)
  in
  let state =
    (Ta_core.Dashboard_runner.step ~refresh state
       (Ta_core.Dashboard_runner.tick_event (timestamp 10.0)))
      .state
  in
  let rendered =
    Ta_core.Dashboard_runner.render ~now:(timestamp 12.0) ~width:90 state
  in
  Alcotest.(check bool)
    "cadence" true
    (contains_substring ~needle:"Refresh cadence: fresh, last success 2.0s ago"
       rendered);
  Alcotest.(check bool)
    "reason" true
    (contains_substring ~needle:"Last refresh reason: never-refreshed" rendered)

let expect_key_roundtrip () =
  let long = String.make 65 'x' in
  Alcotest.(check string)
    "empty key" ""
    (Ta_core.Dashboard_runner.key_to_string (Ta_core.Dashboard_runner.key ""));
  Alcotest.(check string)
    "long key" long
    (Ta_core.Dashboard_runner.key_to_string (Ta_core.Dashboard_runner.key long))

let expect_unknown_key_is_noop () =
  let long = String.make 65 'x' in
  let calls = ref 0 in
  let refresh () =
    incr calls;
    Ok (dashboard_at 10.0)
  in
  let state =
    Ta_core.Dashboard_runner.init ~policy:(policy ()) (dashboard_at 0.0)
  in
  let state =
    Ta_core.Dashboard_runner.run ~refresh state
      [ Ta_core.Dashboard_runner.key_event ~at:(timestamp 10.0) long ]
  in
  Alcotest.(check int) "refresh calls" 0 !calls;
  Alcotest.(check string)
    "agent unchanged" "lead"
    (as_agent
       (Ta_core.Dashboard_interaction.selected_agent
          (Ta_core.Dashboard_runner.interaction state)))

let () =
  Alcotest.run "dashboard-runner"
    [
      ( "dashboard_runner",
        [
          Alcotest.test_case "first tick refreshes" `Quick
            expect_first_tick_refreshes;
          Alcotest.test_case "tick waits until interval" `Quick
            expect_tick_waits_until_interval;
          Alcotest.test_case "manual refresh preserves selection" `Quick
            expect_manual_refresh_preserves_selection;
          Alcotest.test_case "refresh failure marks stale" `Quick
            expect_refresh_failure_marks_stale;
          Alcotest.test_case "quit suppresses refresh" `Quick
            expect_quit_suppresses_refresh;
          Alcotest.test_case "render includes cadence" `Quick
            expect_render_includes_cadence;
          Alcotest.test_case "key roundtrip" `Quick expect_key_roundtrip;
          Alcotest.test_case "unknown key is noop" `Quick
            expect_unknown_key_is_noop;
        ] );
    ]
