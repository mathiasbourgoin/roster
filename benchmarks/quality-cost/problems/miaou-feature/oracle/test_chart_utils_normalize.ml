(* Hidden oracle test for the `normalize` feature. The agent never sees this.
   Fails-before (function absent -> build error) / passes-after (correct impl). *)
open Alcotest

let close a b = abs_float (a -. b) < 1e-9

let flist =
  testable
    (fun ppf l ->
      Format.fprintf ppf "[%s]" (String.concat "; " (List.map string_of_float l)))
    (fun a b -> List.length a = List.length b && List.for_all2 close a b)

let test_basic () =
  check flist "0,0.5,1" [ 0.; 0.5; 1. ]
    (Miaou_widgets_display.Chart_utils.normalize [ 0.; 5.; 10. ])

let test_empty () =
  check flist "empty" [] (Miaou_widgets_display.Chart_utils.normalize [])

let test_all_equal () =
  check flist "all zero" [ 0.; 0.; 0. ]
    (Miaou_widgets_display.Chart_utils.normalize [ 7.; 7.; 7. ])

let test_negatives () =
  check flist "neg range" [ 0.; 0.5; 1. ]
    (Miaou_widgets_display.Chart_utils.normalize [ -10.; 0.; 10. ])

let () =
  run "chart_utils_normalize"
    [ ( "normalize",
        [ test_case "basic" `Quick test_basic;
          test_case "empty" `Quick test_empty;
          test_case "all_equal" `Quick test_all_equal;
          test_case "negatives" `Quick test_negatives ] ) ]
