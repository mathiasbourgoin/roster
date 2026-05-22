type command_result = {
  status : Unix.process_status;
  stdout : string;
  stderr : string;
}

type server = { pid : int; stdout_path : string; stderr_path : string }

let tactl_exe () =
  match Sys.getenv_opt "TACTL_EXE" with
  | Some value -> value
  | None -> Alcotest.fail "TACTL_EXE is not set"

let fixture name = Filename.concat "fixtures" name
let remove_noerr path = try Sys.remove path with Sys_error _ -> ()
let rmdir_noerr path = try Unix.rmdir path with Unix.Unix_error _ -> ()

let write_file path contents =
  let channel = open_out path in
  Fun.protect
    ~finally:(fun () -> close_out_noerr channel)
    (fun () -> output_string channel contents)

let read_all channel =
  let buffer = Buffer.create 256 in
  let bytes = Bytes.create 4096 in
  let rec loop () =
    match input channel bytes 0 (Bytes.length bytes) with
    | 0 -> Buffer.contents buffer
    | read ->
        Buffer.add_subbytes buffer bytes 0 read;
        loop ()
  in
  loop ()

let read_file path =
  let channel = open_in path in
  Fun.protect
    ~finally:(fun () -> close_in_noerr channel)
    (fun () -> read_all channel)

let run_tactl args =
  let argv = Array.of_list (tactl_exe () :: args) in
  let stdout_tmp, stdout_channel = Filename.open_temp_file "ta-socket" ".out" in
  let stderr_tmp, stderr_channel = Filename.open_temp_file "ta-socket" ".err" in
  Fun.protect
    ~finally:(fun () ->
      close_out_noerr stdout_channel;
      close_out_noerr stderr_channel;
      remove_noerr stdout_tmp;
      remove_noerr stderr_tmp)
    (fun () ->
      let pid =
        Unix.create_process (tactl_exe ()) argv Unix.stdin
          (Unix.descr_of_out_channel stdout_channel)
          (Unix.descr_of_out_channel stderr_channel)
      in
      let _, status = Unix.waitpid [] pid in
      close_out stdout_channel;
      close_out stderr_channel;
      let stdout_in = open_in stdout_tmp in
      let stderr_in = open_in stderr_tmp in
      Fun.protect
        ~finally:(fun () ->
          close_in_noerr stdout_in;
          close_in_noerr stderr_in)
        (fun () ->
          { status; stdout = read_all stdout_in; stderr = read_all stderr_in }))

let check_exit label expected = function
  | Unix.WEXITED code -> Alcotest.(check int) label expected code
  | Unix.WSIGNALED signal ->
      Alcotest.failf "%s: process signaled %d" label signal
  | Unix.WSTOPPED signal -> Alcotest.failf "%s: process stopped %d" label signal

let contains_substring ~needle value =
  let needle_len = String.length needle in
  let value_len = String.length value in
  let rec loop idx =
    if idx + needle_len > value_len then false
    else if String.sub value idx needle_len = needle then true
    else loop (idx + 1)
  in
  String.equal needle "" || loop 0

let with_temp_dir f =
  let base =
    Filename.concat
      (Filename.get_temp_dir_name ())
      ("ta-socket-" ^ string_of_int (Unix.getpid ()))
  in
  let rec fresh idx =
    let path = base ^ "-" ^ string_of_int idx in
    if Sys.file_exists path then fresh (idx + 1) else path
  in
  let dir = fresh 0 in
  Unix.mkdir dir 0o700;
  Fun.protect
    ~finally:(fun () ->
      Sys.readdir dir
      |> Array.iter (fun name -> remove_noerr (Filename.concat dir name));
      rmdir_noerr dir)
    (fun () -> f dir)

let wait_short () = ignore (Unix.select [] [] [] 0.05 : _ * _ * _)

let wait_for_socket socket_path =
  let rec loop remaining =
    if Sys.file_exists socket_path then ()
    else if remaining = 0 then Alcotest.fail "socket did not appear"
    else (
      wait_short ();
      loop (remaining - 1))
  in
  loop 100

let start_server ~socket_path ~state_path =
  let stdout_path, stdout_channel =
    Filename.open_temp_file "ta-server" ".out"
  in
  let stderr_path, stderr_channel =
    Filename.open_temp_file "ta-server" ".err"
  in
  let argv =
    [|
      tactl_exe ();
      "socket";
      "serve";
      "--once";
      "--socket";
      socket_path;
      "--state";
      state_path;
    |]
  in
  let pid =
    Unix.create_process (tactl_exe ()) argv Unix.stdin
      (Unix.descr_of_out_channel stdout_channel)
      (Unix.descr_of_out_channel stderr_channel)
  in
  close_out stdout_channel;
  close_out stderr_channel;
  { pid; stdout_path; stderr_path }

let wait_server server =
  let _, status = Unix.waitpid [] server.pid in
  let stdout = read_file server.stdout_path in
  let stderr = read_file server.stderr_path in
  remove_noerr server.stdout_path;
  remove_noerr server.stderr_path;
  { status; stdout; stderr }

let with_socket_server ~state_path ~socket_path f =
  let server = start_server ~socket_path ~state_path in
  let waited = ref false in
  Fun.protect
    ~finally:(fun () ->
      if not !waited then (
        (try Unix.kill server.pid Sys.sigterm with Unix.Unix_error _ -> ());
        ignore (Unix.waitpid [] server.pid : int * Unix.process_status));
      remove_noerr socket_path)
    (fun () ->
      wait_for_socket socket_path;
      let result = f () in
      let server_result = wait_server server in
      waited := true;
      check_exit "server exit" 0 server_result.status;
      Alcotest.(check string) "server stdout" "" server_result.stdout;
      Alcotest.(check string) "server stderr" "" server_result.stderr;
      result)

let save_state state_path =
  let result =
    run_tactl
      [ "state"; "save"; "--output"; state_path; fixture "ta-valid.json" ]
  in
  check_exit "save exit" 0 result.status;
  Alcotest.(check string) "save stderr" "" result.stderr

let expect_socket_state_summary () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      with_socket_server ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [ "socket"; "request"; "--socket"; socket_path; "state-summary" ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "summary" true
            (contains_substring
               ~needle:
                 "TA state snapshot: 1 workspace(s), 2 agent(s), 1 audit \
                  event(s)"
               result.stdout)))

let expect_socket_state_show () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      with_socket_server ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [
                "socket";
                "request";
                "--socket";
                socket_path;
                "--audit-limit";
                "1";
                "state-show";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "show workspace" true
            (contains_substring ~needle:"Workspace fixture (Fixture)"
               result.stdout);
          Alcotest.(check bool)
            "show audit" true
            (contains_substring
               ~needle:"#1 fixture actor=system workspace-loaded" result.stdout)))

let expect_socket_unknown_command () =
  with_temp_dir (fun dir ->
      let socket_path = Filename.concat dir "ta.sock" in
      let result =
        run_tactl
          [ "socket"; "request"; "--socket"; socket_path; "unknown-command" ]
      in
      check_exit "request exit" 2 result.status;
      Alcotest.(check bool)
        "unknown command" true
        (contains_substring ~needle:"unknown socket command: unknown-command"
           result.stderr))

let expect_socket_negative_audit_limit () =
  with_temp_dir (fun dir ->
      let socket_path = Filename.concat dir "ta.sock" in
      let result =
        run_tactl
          [
            "socket";
            "request";
            "--socket";
            socket_path;
            "--audit-limit=-1";
            "state-show";
          ]
      in
      check_exit "request exit" 2 result.status;
      Alcotest.(check bool)
        "negative audit limit" true
        (contains_substring ~needle:"--audit-limit must be non-negative"
           result.stderr))

let expect_socket_refuses_regular_file_path () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      write_file socket_path "do-not-delete";
      let result =
        run_tactl
          [
            "socket";
            "serve";
            "--once";
            "--socket";
            socket_path;
            "--state";
            state_path;
          ]
      in
      check_exit "serve exit" 1 result.status;
      Alcotest.(check bool)
        "regular file error" true
        (contains_substring ~needle:"exists and is not a Unix socket"
           result.stderr);
      Alcotest.(check string)
        "file preserved" "do-not-delete" (read_file socket_path))

let () =
  Alcotest.run "tactl-socket-cli"
    [
      ( "socket",
        [
          Alcotest.test_case "state summary" `Quick expect_socket_state_summary;
          Alcotest.test_case "state show" `Quick expect_socket_state_show;
          Alcotest.test_case "unknown command" `Quick
            expect_socket_unknown_command;
          Alcotest.test_case "negative audit limit" `Quick
            expect_socket_negative_audit_limit;
          Alcotest.test_case "refuses regular file path" `Quick
            expect_socket_refuses_regular_file_path;
        ] );
    ]
