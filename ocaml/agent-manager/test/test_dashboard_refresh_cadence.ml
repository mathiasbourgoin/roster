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

let decision_to_string = function
  | Ta_core.Dashboard_refresh_cadence.Refresh reason ->
      "refresh:" ^ Ta_core.Dashboard_refresh_cadence.reason_to_string reason
  | Wait seconds ->
      "wait:"
      ^ Printf.sprintf "%.1f"
          (Ta_core.Dashboard_refresh_cadence.seconds_to_float seconds)

let expect_manual_overrides_interval () =
  let state =
    Ta_core.Dashboard_refresh_cadence.init
    |> Ta_core.Dashboard_refresh_cadence.record_success ~at:(timestamp 10.0)
  in
  let decision =
    Ta_core.Dashboard_refresh_cadence.decide (policy ()) state
      ~now:(timestamp 11.0) ~manual:true
  in
  Alcotest.(check string)
    "decision" "refresh:manual"
    (decision_to_string decision)

let expect_tick_waits_until_interval () =
  let state =
    Ta_core.Dashboard_refresh_cadence.init
    |> Ta_core.Dashboard_refresh_cadence.record_success ~at:(timestamp 10.0)
  in
  let decision =
    Ta_core.Dashboard_refresh_cadence.decide (policy ()) state
      ~now:(timestamp 12.0) ~manual:false
  in
  Alcotest.(check string) "decision" "wait:3.0" (decision_to_string decision)

let expect_tick_refreshes_after_interval () =
  let state =
    Ta_core.Dashboard_refresh_cadence.init
    |> Ta_core.Dashboard_refresh_cadence.record_success ~at:(timestamp 10.0)
  in
  let decision =
    Ta_core.Dashboard_refresh_cadence.decide (policy ()) state
      ~now:(timestamp 15.0) ~manual:false
  in
  Alcotest.(check string)
    "decision" "refresh:interval-elapsed"
    (decision_to_string decision)

let expect_stale_threshold () =
  let state =
    Ta_core.Dashboard_refresh_cadence.init
    |> Ta_core.Dashboard_refresh_cadence.record_success ~at:(timestamp 10.0)
  in
  Alcotest.(check bool)
    "stale" true
    (Ta_core.Dashboard_refresh_cadence.is_stale (policy ()) state
       ~now:(timestamp 25.0));
  let decision =
    Ta_core.Dashboard_refresh_cadence.decide (policy ()) state
      ~now:(timestamp 25.0) ~manual:false
  in
  Alcotest.(check string)
    "decision" "refresh:stale"
    (decision_to_string decision)

let expect_retry_throttles_tick_after_failure () =
  let state =
    Ta_core.Dashboard_refresh_cadence.init
    |> Ta_core.Dashboard_refresh_cadence.record_failure ~at:(timestamp 10.0)
  in
  let decision =
    Ta_core.Dashboard_refresh_cadence.decide (policy ()) state
      ~now:(timestamp 11.0) ~manual:false
  in
  Alcotest.(check string) "decision" "wait:1.0" (decision_to_string decision)

let expect_status_line () =
  let state =
    Ta_core.Dashboard_refresh_cadence.init
    |> Ta_core.Dashboard_refresh_cadence.record_success ~at:(timestamp 10.0)
    |> Ta_core.Dashboard_refresh_cadence.record_failure ~at:(timestamp 20.0)
  in
  Alcotest.(check string)
    "status" "Refresh cadence: stale, last success 20.0s ago, failures 1"
    (Ta_core.Dashboard_refresh_cadence.status_line (policy ()) state
       ~now:(timestamp 30.0))

let expect_rejects_bad_policy () =
  match
    Ta_core.Dashboard_refresh_cadence.policy ~refresh_interval:(seconds 10.0)
      ~stale_after:(seconds 5.0) ~min_retry_interval:(seconds 0.0)
  with
  | Ok _ -> Alcotest.fail "expected policy error"
  | Error message ->
      Alcotest.(check string)
        "error" "stale_after must be greater than or equal to refresh_interval"
        message

let () =
  Alcotest.run "dashboard-refresh-cadence"
    [
      ( "dashboard_refresh_cadence",
        [
          Alcotest.test_case "manual overrides interval" `Quick
            expect_manual_overrides_interval;
          Alcotest.test_case "tick waits until interval" `Quick
            expect_tick_waits_until_interval;
          Alcotest.test_case "tick refreshes after interval" `Quick
            expect_tick_refreshes_after_interval;
          Alcotest.test_case "stale threshold" `Quick expect_stale_threshold;
          Alcotest.test_case "retry throttles tick after failure" `Quick
            expect_retry_throttles_tick_after_failure;
          Alcotest.test_case "status line" `Quick expect_status_line;
          Alcotest.test_case "rejects bad policy" `Quick
            expect_rejects_bad_policy;
        ] );
    ]
