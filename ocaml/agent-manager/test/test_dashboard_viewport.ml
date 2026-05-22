let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let height value =
  match Ta_core.Dashboard_viewport.height value with
  | Ok height -> height
  | Error message -> Alcotest.fail message

let lines value = String.split_on_char '\n' value

let expect_height_rejects_non_positive () =
  match Ta_core.Dashboard_viewport.height 0 with
  | Ok _ -> Alcotest.fail "expected invalid height"
  | Error message ->
      Alcotest.(check string) "message" "height must be positive" message

let expect_short_frame_is_unchanged () =
  let frame = "header\nbody" in
  Alcotest.(check string)
    "frame" frame
    (Ta_core.Dashboard_viewport.clip ~height:(height 3) frame)

let expect_clip_adds_marker () =
  let frame =
    String.concat "\n"
      [
        "wide dashboard frame line used for marker width";
        "workspaces";
        "agents";
        "preview";
      ]
  in
  let clipped = Ta_core.Dashboard_viewport.clip ~height:(height 3) frame in
  Alcotest.(check int) "height" 3 (List.length (lines clipped));
  Alcotest.(check bool)
    "marker" true
    (contains_substring ~needle:"2 line(s) clipped" clipped)

let () =
  Alcotest.run "dashboard-viewport"
    [
      ( "viewport",
        [
          Alcotest.test_case "rejects non-positive height" `Quick
            expect_height_rejects_non_positive;
          Alcotest.test_case "short frame unchanged" `Quick
            expect_short_frame_is_unchanged;
          Alcotest.test_case "clip marker" `Quick expect_clip_adds_marker;
        ] );
    ]
