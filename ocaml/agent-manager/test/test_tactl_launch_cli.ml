type command_result = {
  status : Unix.process_status;
  stdout : string;
  stderr : string;
}

let tactl_exe () =
  match Sys.getenv_opt "TACTL_EXE" with
  | Some value -> value
  | None -> Alcotest.fail "TACTL_EXE is not set"

let fixture name = Filename.concat "fixtures" name
let remove_noerr path = try Sys.remove path with Sys_error _ -> ()

let absolute_path path =
  if Filename.is_relative path then Filename.concat (Sys.getcwd ()) path
  else path

let prompt_config =
  {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "fixture",
      "label": "Fixture",
      "root": ".",
      "tmux_session": "ta-fixture-prompt",
      "default_view": "agents",
      "views": [{"id": "agents", "label": "Agents"}],
      "agents": [
        {
          "name": "lead",
          "roster_agent": "tech-lead",
          "command": ["codex"],
          "startup_prompt": "Start lead"
        }
      ]
    }
  ]
}
|}

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

let run_tactl args =
  let argv = Array.of_list (tactl_exe () :: args) in
  let stdout_tmp, stdout_channel = Filename.open_temp_file "ta-launch" ".out" in
  let stderr_tmp, stderr_channel = Filename.open_temp_file "ta-launch" ".err" in
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

let with_temp_file contents f =
  let path, channel = Filename.open_temp_file "ta-prompt" ".json" in
  Fun.protect
    ~finally:(fun () -> remove_noerr path)
    (fun () ->
      output_string channel contents;
      close_out channel;
      f path)

let check_exit label expected = function
  | Unix.WEXITED code -> Alcotest.(check int) label expected code
  | Unix.WSIGNALED signal ->
      Alcotest.failf "%s: process signaled %d" label signal
  | Unix.WSTOPPED signal -> Alcotest.failf "%s: process stopped %d" label signal

let expect_launch_start_dry_run () =
  let fixture_root = Filename.dirname (absolute_path (fixture "ta-valid.json")) in
  let result =
    run_tactl [ "launch"; "start"; "--dry-run"; fixture "ta-valid.json" ]
  in
  check_exit "exit" 0 result.status;
  Alcotest.(check string) "stderr" "" result.stderr;
  Alcotest.(check string)
    "stdout"
    (String.concat "\n"
       [
         "tmux new-session -d -P -F '#{pane_id}' -s ta-fixture -c "
         ^ fixture_root ^ " 'codex'";
         "tmux split-window -d -P -F '#{pane_id}' -t ta-fixture -c "
         ^ fixture_root ^ " 'codex'";
         "tmux select-layout -t ta-fixture tiled";
       ]
    ^ "\n")
    result.stdout

let expect_launch_start_dry_run_accepts_state () =
  let result =
    run_tactl
      [
        "launch";
        "start";
        "--dry-run";
        "--state";
        "fixtures/unused-state.json";
        fixture "ta-valid.json";
      ]
  in
  check_exit "exit" 0 result.status;
  Alcotest.(check string) "stderr" "" result.stderr

let expect_launch_start_dry_run_shows_prompt_placeholder () =
  with_temp_file prompt_config (fun path ->
      let result = run_tactl [ "launch"; "start"; "--dry-run"; path ] in
      check_exit "exit" 0 result.status;
      Alcotest.(check string) "stderr" "" result.stderr;
      Alcotest.(check bool)
        "prompt placeholder" true
        (List.exists
           (String.equal
              "# startup prompt for fixture/lead will be sent to the captured \
               native pane id")
           (String.split_on_char '\n' result.stdout)))

let () =
  Alcotest.run "tactl-launch-cli"
    [
      ( "launch",
        [
          Alcotest.test_case "start dry run" `Quick expect_launch_start_dry_run;
          Alcotest.test_case "start dry run accepts state" `Quick
            expect_launch_start_dry_run_accepts_state;
          Alcotest.test_case "start dry run shows prompt placeholder" `Quick
            expect_launch_start_dry_run_shows_prompt_placeholder;
        ] );
    ]
