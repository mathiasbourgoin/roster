(* Hidden feature oracle: F1-F12 parsing. The agent never sees this. *)
open Alcotest
module Parser = Miaou_driver_common.Input_parser

let parser_with_input input =
  let r, w = Unix.pipe () in
  let _ = Unix.write_substring w input 0 (String.length input) in
  Unix.close w ;
  let p = Parser.create r in
  ignore (Parser.refill p ~timeout_s:0.1) ;
  (p, r)

let pkey seq =
  let p, r = parser_with_input seq in
  let k = Parser.parse_key p in
  (try Unix.close r with _ -> ()) ;
  k

let check_fkey name seq n =
  match pkey seq with
  | Some (Parser.Function m) -> check int name n m
  | other ->
    failf "%s: expected Function %d, got %s" name n
      (match other with Some k -> Parser.key_to_string k | None -> "None")

let test_fkeys () =
  check_fkey "F1" "\027OP" 1 ;
  check_fkey "F2" "\027OQ" 2 ;
  check_fkey "F3" "\027OR" 3 ;
  check_fkey "F4" "\027OS" 4 ;
  check_fkey "F5" "\027[15~" 5 ;
  check_fkey "F6" "\027[17~" 6 ;
  check_fkey "F7" "\027[18~" 7 ;
  check_fkey "F8" "\027[19~" 8 ;
  check_fkey "F9" "\027[20~" 9 ;
  check_fkey "F10" "\027[21~" 10 ;
  check_fkey "F11" "\027[23~" 11 ;
  check_fkey "F12" "\027[24~" 12

let test_kts () =
  check string "F1 kts" "F1" (Parser.key_to_string (Parser.Function 1)) ;
  check string "F12 kts" "F12" (Parser.key_to_string (Parser.Function 12))

let () =
  run "input_parser_fkeys"
    [ ("fkeys", [ test_case "parse" `Quick test_fkeys; test_case "to_string" `Quick test_kts ]) ]
