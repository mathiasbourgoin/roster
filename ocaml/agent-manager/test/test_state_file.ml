let fixture name = Filename.concat "fixtures" name
let remove_noerr path = try Sys.remove path with Sys_error _ -> ()

let valid_store () =
  match Ta_core.Workspace_config.load (fixture "ta-valid.json") with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config -> (
      match Ta_core.State_store.of_config config with
      | Ok store -> store
      | Error errors ->
          Alcotest.fail
            (String.concat "\n"
               (List.map Ta_core.Workspace_config.error_to_string errors)))

let with_temp_file f =
  let path = Filename.temp_file "ta-state" ".json" in
  Fun.protect ~finally:(fun () -> remove_noerr path) (fun () -> f path)

let write_text path text =
  let channel = open_out path in
  Fun.protect
    ~finally:(fun () -> close_out_noerr channel)
    (fun () -> output_string channel text)

let expect_save_load_roundtrip () =
  with_temp_file (fun path ->
      match Ta_core.State_file.save ~path (valid_store ()) with
      | Error error -> Alcotest.fail (Ta_core.State_file.error_to_string error)
      | Ok () -> (
          match Ta_core.State_file.load ~path with
          | Error error ->
              Alcotest.fail (Ta_core.State_file.error_to_string error)
          | Ok store ->
              Alcotest.(check int)
                "workspace count" 1
                (List.length (Ta_core.State_store.workspaces store));
              Alcotest.(check int)
                "audit event count" 1
                (List.length (Ta_core.State_store.audit_events store))))

let expect_bad_json_error () =
  with_temp_file (fun path ->
      write_text path "{";
      match Ta_core.State_file.load ~path with
      | Ok _ -> Alcotest.fail "bad JSON should fail"
      | Error (Ta_core.State_file.Json _) -> ()
      | Error error -> Alcotest.fail (Ta_core.State_file.error_to_string error))

let expect_snapshot_error_mentions_file () =
  with_temp_file (fun path ->
      write_text path
        {|{"version":"9.9.9","next_seq":1,"workspaces":[],"audit_events":[]}|};
      match Ta_core.State_file.load ~path with
      | Ok _ -> Alcotest.fail "bad snapshot should fail"
      | Error (Ta_core.State_file.Snapshot { path = error_path; _ }) ->
          Alcotest.(check string) "path" path error_path
      | Error error -> Alcotest.fail (Ta_core.State_file.error_to_string error))

let () =
  Alcotest.run "state-file"
    [
      ( "state_file",
        [
          Alcotest.test_case "save load roundtrip" `Quick
            expect_save_load_roundtrip;
          Alcotest.test_case "bad json error" `Quick expect_bad_json_error;
          Alcotest.test_case "snapshot error mentions file" `Quick
            expect_snapshot_error_mentions_file;
        ] );
    ]
