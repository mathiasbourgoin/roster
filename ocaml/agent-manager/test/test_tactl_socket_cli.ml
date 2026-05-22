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

let absolute_path path =
  if Filename.is_relative path then Filename.concat (Sys.getcwd ()) path
  else path

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

let lines_containing ~needle value =
  value |> String.split_on_char '\n' |> List.filter (contains_substring ~needle)

let field name = function
  | `Assoc fields -> (
      match List.assoc_opt name fields with
      | Some value -> value
      | None -> Alcotest.fail ("missing JSON field: " ^ name))
  | _ -> Alcotest.fail ("expected JSON object for field: " ^ name)

let as_list label = function
  | `List values -> values
  | _ -> Alcotest.fail ("expected JSON list: " ^ label)

let as_string label = function
  | `String value -> value
  | _ -> Alcotest.fail ("expected JSON string: " ^ label)

let as_int label = function
  | `Int value -> value
  | _ -> Alcotest.fail ("expected JSON int: " ^ label)

let json_fields label = function
  | `Assoc fields -> fields
  | _ -> Alcotest.fail ("expected JSON object: " ^ label)

let action_intent action = field "intent" action

let action_kind action =
  action |> action_intent |> field "kind" |> as_string "intent.kind"

let has_action ?agent ?to_agent kind actions =
  List.exists
    (fun action ->
      let intent = action_intent action in
      let matches_agent =
        match agent with
        | None -> true
        | Some expected -> (
            match List.assoc_opt "agent" (json_fields "intent" intent) with
            | Some value -> String.equal expected (as_string "agent" value)
            | None -> false)
      in
      let matches_to_agent =
        match to_agent with
        | None -> true
        | Some expected -> (
            match List.assoc_opt "to_agent" (json_fields "intent" intent) with
            | Some value -> String.equal expected (as_string "to_agent" value)
            | None -> false)
      in
      String.equal kind (action_kind action)
      && matches_agent && matches_to_agent)
    actions

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

let with_temp_dir_mode mode f =
  let base =
    Filename.concat
      (Filename.get_temp_dir_name ())
      ("ta-socket-mode-" ^ string_of_int (Unix.getpid ()))
  in
  let rec fresh idx =
    let path = base ^ "-" ^ string_of_int idx in
    if Sys.file_exists path then fresh (idx + 1) else path
  in
  let dir = fresh 0 in
  Unix.mkdir dir mode;
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

let socket_mode socket_path =
  let stats = Unix.stat socket_path in
  stats.Unix.st_perm land 0o777

let start_server ?server_cwd ~socket_path ~state_path () =
  let stdout_path, stdout_channel =
    Filename.open_temp_file "ta-server" ".out"
  in
  let stderr_path, stderr_channel =
    Filename.open_temp_file "ta-server" ".err"
  in
  let program, argv =
    match server_cwd with
    | None ->
        ( tactl_exe (),
          [|
            tactl_exe ();
            "socket";
            "serve";
            "--once";
            "--socket";
            socket_path;
            "--state";
            state_path;
          |] )
    | Some cwd ->
        ( "/bin/sh",
          [|
            "sh";
            "-lc";
            "cd \"$1\" && exec \"$2\" socket serve --once --socket \"$3\" \
             --state \"$4\"";
            "sh";
            cwd;
            absolute_path (tactl_exe ());
            socket_path;
            state_path;
          |] )
  in
  let pid =
    Unix.create_process program argv Unix.stdin
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

let with_socket_server ?server_cwd ~state_path ~socket_path f =
  let server = start_server ?server_cwd ~socket_path ~state_path () in
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

let save_state_from_config state_path config_path =
  let result =
    run_tactl [ "state"; "save"; "--output"; state_path; config_path ]
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

let expect_socket_set_status () =
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
                "--workspace";
                "fixture";
                "--agent";
                "lead";
                "--status";
                "running";
                "--actor";
                "lead";
                "set-status";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "summary advanced" true
            (contains_substring ~needle:"2 audit event(s)" result.stdout));
      let show =
        run_tactl [ "state"; "show"; "--audit-limit"; "2"; state_path ]
      in
      check_exit "show exit" 0 show.status;
      Alcotest.(check bool)
        "status changed" true
        (contains_substring ~needle:"- lead [running]" show.stdout);
      Alcotest.(check bool)
        "audit status" true
        (contains_substring ~needle:"status lead: not-started -> running"
           show.stdout))

let expect_socket_attach_pane () =
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
                "--workspace";
                "fixture";
                "--agent";
                "qa";
                "--pane";
                "%88";
                "--actor";
                "qa";
                "attach-pane";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "summary advanced" true
            (contains_substring ~needle:"2 audit event(s)" result.stdout));
      let show =
        run_tactl [ "state"; "show"; "--audit-limit"; "2"; state_path ]
      in
      check_exit "show exit" 0 show.status;
      Alcotest.(check bool)
        "pane attached" true
        (contains_substring ~needle:"- qa [not-started] roster=qa pane=%88"
           show.stdout);
      Alcotest.(check bool)
        "audit pane" true
        (contains_substring ~needle:"pane qa: %88" show.stdout))

let expect_socket_runtime_snapshot () =
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
                "--lines";
                "5";
                "--workspace";
                "fixture";
                "--agent";
                "lead";
                "--actor";
                "lead";
                "runtime-snapshot";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          let json = Yojson.Safe.from_string result.stdout in
          Alcotest.(check string)
            "version" "0.1.0"
            (json |> field "version" |> as_string "version");
          let workspaces = json |> field "workspaces" |> as_list "workspaces" in
          Alcotest.(check int) "workspace count" 1 (List.length workspaces);
          match workspaces with
          | [ workspace ] ->
              let agents = workspace |> field "agents" |> as_list "agents" in
              Alcotest.(check int) "agent count" 1 (List.length agents);
              let lead =
                agents
                |> List.find_opt (fun agent ->
                    String.equal "lead"
                      (agent |> field "name" |> as_string "name"))
                |> function
                | Some agent -> agent
                | None -> Alcotest.fail "missing lead"
              in
              Alcotest.(check string)
                "lead unattached" "unattached"
                (lead |> field "pane_state" |> field "kind" |> as_string "kind")
          | _ -> Alcotest.fail "expected one workspace"))

let expect_socket_runtime_snapshot_requires_actor () =
  with_temp_dir (fun dir ->
      let socket_path = Filename.concat dir "ta.sock" in
      let result =
        run_tactl
          [
            "socket";
            "request";
            "--socket";
            socket_path;
            "--workspace";
            "fixture";
            "--agent";
            "lead";
            "runtime-snapshot";
          ]
      in
      check_exit "request exit" 2 result.status;
      Alcotest.(check bool)
        "actor required" true
        (contains_substring ~needle:"--actor is required for runtime-snapshot"
           result.stderr))

let expect_socket_runtime_snapshot_rejects_unauthorized_actor () =
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
                "--workspace";
                "fixture";
                "--agent";
                "lead";
                "--actor";
                "qa";
                "runtime-snapshot";
              ]
          in
          check_exit "request exit" 1 result.status;
          Alcotest.(check bool)
            "read denied" true
            (contains_substring ~needle:"actor qa cannot read agent lead"
               result.stderr)))

let expect_socket_runtime_snapshot_rejects_bad_lines () =
  with_temp_dir (fun dir ->
      let socket_path = Filename.concat dir "ta.sock" in
      let result =
        run_tactl
          [
            "socket";
            "request";
            "--socket";
            socket_path;
            "--lines";
            "0";
            "--workspace";
            "fixture";
            "--agent";
            "lead";
            "--actor";
            "lead";
            "runtime-snapshot";
          ]
      in
      check_exit "request exit" 2 result.status;
      Alcotest.(check bool)
        "line error" true
        (contains_substring ~needle:"--lines must be positive" result.stderr))

let expect_socket_runtime_snapshot_rejects_large_lines () =
  with_temp_dir (fun dir ->
      let socket_path = Filename.concat dir "ta.sock" in
      let result =
        run_tactl
          [
            "socket";
            "request";
            "--socket";
            socket_path;
            "--lines";
            "201";
            "--workspace";
            "fixture";
            "--agent";
            "lead";
            "--actor";
            "lead";
            "runtime-snapshot";
          ]
      in
      check_exit "request exit" 2 result.status;
      Alcotest.(check bool)
        "line cap" true
        (contains_substring ~needle:"--lines must be at most" result.stderr))

let expect_socket_dashboard_snapshot_actor_scoped () =
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
                "--lines";
                "5";
                "--actor";
                "qa";
                "dashboard-snapshot";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          let json = Yojson.Safe.from_string result.stdout in
          let state_workspaces =
            json |> field "state" |> field "workspaces" |> as_list "workspaces"
          in
          Alcotest.(check int)
            "state workspace count" 1
            (List.length state_workspaces);
          let state_agents =
            match state_workspaces with
            | [ workspace ] -> workspace |> field "agents" |> as_list "agents"
            | _ -> Alcotest.fail "expected one state workspace"
          in
          Alcotest.(check int) "state agent count" 1 (List.length state_agents);
          let state_agent =
            match state_agents with
            | [ agent ] -> agent
            | _ -> Alcotest.fail "expected one state agent"
          in
          Alcotest.(check string)
            "state agent" "qa"
            (state_agent |> field "name" |> as_string "name");
          let runtime_workspaces =
            json |> field "runtime" |> field "workspaces"
            |> as_list "runtime workspaces"
          in
          let runtime_agents =
            match runtime_workspaces with
            | [ workspace ] -> workspace |> field "agents" |> as_list "agents"
            | _ -> Alcotest.fail "expected one runtime workspace"
          in
          Alcotest.(check int)
            "runtime agent count" 1
            (List.length runtime_agents);
          let runtime_agent =
            match runtime_agents with
            | [ agent ] -> agent
            | _ -> Alcotest.fail "expected one runtime agent"
          in
          Alcotest.(check string)
            "runtime agent" "qa"
            (runtime_agent |> field "name" |> as_string "name");
          Alcotest.(check bool)
            "raw snapshot has no frontmatter role text" false
            (contains_substring ~needle:"Frontmatter" result.stdout);
          Alcotest.(check bool)
            "raw snapshot has no pipeline role key" false
            (contains_substring ~needle:"pipeline_role" result.stdout);
          Alcotest.(check bool)
            "raw snapshot has no pipeline detail label" false
            (contains_substring ~needle:"Pipeline: triggered by" result.stdout);
          Alcotest.(check bool)
            "raw snapshot has no profile detail label" false
            (contains_substring ~needle:"Profile: model" result.stdout)))

let expect_socket_dashboard_snapshot_requires_actor () =
  with_temp_dir (fun dir ->
      let socket_path = Filename.concat dir "ta.sock" in
      let result =
        run_tactl
          [ "socket"; "request"; "--socket"; socket_path; "dashboard-snapshot" ]
      in
      check_exit "request exit" 2 result.status;
      Alcotest.(check bool)
        "actor required" true
        (contains_substring ~needle:"--actor is required for dashboard-snapshot"
           result.stderr))

let expect_socket_dashboard_snapshot_rejects_unknown_actor () =
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
                "--actor";
                "missing";
                "dashboard-snapshot";
              ]
          in
          check_exit "request exit" 1 result.status;
          Alcotest.(check bool)
            "unknown actor" true
            (contains_substring ~needle:"unknown actor: missing" result.stderr)))

let expect_dashboard_render_socket () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      with_socket_server ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [
                "dashboard";
                "render-socket";
                "--socket";
                socket_path;
                "--actor";
                "lead";
                "--key";
                "Down";
                "--width";
                "92";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "dashboard header" true
            (contains_substring ~needle:"TA Dashboard" result.stdout);
          Alcotest.(check bool)
            "selected qa" true
            (contains_substring ~needle:"Preview: fixture/qa" result.stdout)))

let expect_dashboard_actions_socket () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      with_socket_server ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [
                "dashboard";
                "actions-socket";
                "--socket";
                socket_path;
                "--actor";
                "lead";
                "--lines";
                "3";
                "--key";
                "p";
                "--key";
                "Right";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          let json = Yojson.Safe.from_string result.stdout in
          Alcotest.(check string)
            "focus" "pipeline"
            (json |> field "focus" |> as_string "focus");
          Alcotest.(check string)
            "selected target" "qa"
            (json |> field "selected_target" |> field "agent"
            |> as_string "selected_target.agent");
          let actions =
            json |> field "affordance" |> field "actions" |> as_list "actions"
          in
          let target_read =
            match
              List.find_opt
                (fun action ->
                  has_action ~agent:"qa" "runtime-snapshot" [ action ])
                actions
            with
            | Some action -> action
            | None -> Alcotest.fail "missing qa runtime snapshot action"
          in
          Alcotest.(check int)
            "lines" 3
            (target_read |> action_intent |> field "lines" |> as_int "lines");
          Alcotest.(check bool)
            "focus action" true
            (has_action ~agent:"qa" "focus-pane" actions)))

let expect_dashboard_actions_socket_exports_write_only_target () =
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
        {"name": "qa", "roster_agent": "qa", "command": ["codex"]},
        {"name": "writer", "roster_agent": "documenter", "command": ["codex"]}
      ],
      "links": [
        {"from": "lead", "to": "qa", "permissions": ["read"], "reason": "qa"},
        {"from": "lead", "to": "writer", "permissions": ["write"], "reason": "writer"}
      ]
    }
  ]
}
|}
  in
  with_temp_dir (fun dir ->
      let config_path = Filename.concat dir "ta.json" in
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      write_file config_path config;
      save_state_from_config state_path config_path;
      with_socket_server ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [
                "dashboard";
                "actions-socket";
                "--socket";
                socket_path;
                "--actor";
                "lead";
                "--key";
                "p";
                "--key";
                "Right";
                "--key";
                "]";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          let json = Yojson.Safe.from_string result.stdout in
          Alcotest.(check string)
            "selected target" "writer"
            (json |> field "selected_target" |> field "agent"
            |> as_string "selected_target.agent");
          let actions =
            json |> field "affordance" |> field "actions" |> as_list "actions"
          in
          Alcotest.(check bool)
            "writer read hidden" false
            (has_action ~agent:"writer" "runtime-snapshot" actions);
          Alcotest.(check bool)
            "writer focus hidden" false
            (has_action ~agent:"writer" "focus-pane" actions);
          Alcotest.(check bool)
            "writer write visible" true
            (has_action ~to_agent:"writer" "future-agent-message" actions)))

let expect_dashboard_actions_socket_requires_actor () =
  with_temp_dir (fun dir ->
      let socket_path = Filename.concat dir "ta.sock" in
      let result =
        run_tactl [ "dashboard"; "actions-socket"; "--socket"; socket_path ]
      in
      check_exit "request exit" 2 result.status;
      Alcotest.(check bool)
        "actor required" true
        (contains_substring
           ~needle:"--actor is required for dashboard actions-socket"
           result.stderr))

let expect_dashboard_render_socket_uses_roster_index () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      with_socket_server ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [
                "dashboard";
                "render-socket";
                "--socket";
                socket_path;
                "--actor";
                "lead";
                "--roster-index";
                fixture "roster-index.json";
                "--width";
                "96";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "row metadata" true
            (contains_substring ~needle:"Tech Lead/management" result.stdout);
          Alcotest.(check bool)
            "preview metadata" true
            (contains_substring
               ~needle:
                 "Roster: Tech Lead | domain management,orchestration | source \
                  local"
               result.stdout);
          Alcotest.(check bool)
            "frontmatter profile metadata" true
            (contains_substring
               ~needle:"Profile: model opus | complexity high | isolation none"
               result.stdout);
          Alcotest.(check bool)
            "frontmatter compatibility metadata" true
            (contains_substring
               ~needle:
                 "Compat: claude-code,codex | version 9.9.9 | author mathias"
               result.stdout);
          Alcotest.(check bool)
            "frontmatter role metadata" true
            (contains_substring
               ~needle:
                 "Role: Frontmatter coordinates implementation and review."
               result.stdout);
          Alcotest.(check bool)
            "pipeline trigger metadata" true
            (contains_substring ~needle:"Pipeline: triggered by fixture"
               result.stdout);
          Alcotest.(check bool)
            "pipeline receives metadata" true
            (contains_substring ~needle:"Receives: fixture task" result.stdout);
          Alcotest.(check bool)
            "pipeline produces metadata" true
            (contains_substring ~needle:"Produces: fixture plan" result.stdout);
          Alcotest.(check bool)
            "pipeline gate metadata" true
            (contains_substring ~needle:"Human gate: none" result.stdout);
          Alcotest.(check (list string))
            "pipeline appears only in preview detail"
            [ "Pipeline: triggered by fixture" ]
            (result.stdout
            |> lines_containing ~needle:"Pipeline:"
            |> List.map String.trim);
          Alcotest.(check bool)
            "pipeline overview section" true
            (contains_substring ~needle:"Pipeline overview" result.stdout);
          Alcotest.(check bool)
            "pipeline overview contract flag" true
            (contains_substring ~needle:"Tech Lead              contract"
               result.stdout);
          Alcotest.(check bool)
            "pipeline overview acl disclaimer" true
            (contains_substring
               ~needle:"ACL edges (declared links, not inferred workflow order)"
               result.stdout);
          Alcotest.(check bool)
            "pipeline overview acl edge" true
            (contains_substring ~needle:"ACL fixture/lead -> read qa | write -"
               result.stdout)))

let expect_dashboard_render_socket_redacts_pipeline_overview () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      with_socket_server ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [
                "dashboard";
                "render-socket";
                "--socket";
                socket_path;
                "--actor";
                "qa";
                "--roster-index";
                fixture "roster-index.json";
                "--width";
                "96";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "pipeline overview section" true
            (contains_substring ~needle:"Pipeline overview" result.stdout);
          Alcotest.(check bool)
            "qa contract visible" true
            (contains_substring ~needle:"QA                     contract"
               result.stdout);
          Alcotest.(check bool)
            "lead metadata hidden" false
            (contains_substring ~needle:"Tech Lead" result.stdout);
          Alcotest.(check bool)
            "lead acl edge hidden" false
            (contains_substring ~needle:"ACL fixture/lead" result.stdout);
          Alcotest.(check bool)
            "lead preview hidden" false
            (contains_substring ~needle:"Frontmatter coordinates implementation"
               result.stdout)))

let expect_dashboard_render_socket_refresh_failure_is_stale () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      with_socket_server ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [
                "dashboard";
                "render-socket";
                "--socket";
                socket_path;
                "--actor";
                "lead";
                "--key";
                "r";
                "--width";
                "92";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "stale refresh" true
            (contains_substring ~needle:"Refresh: STALE -" result.stdout);
          Alcotest.(check bool)
            "dashboard still rendered" true
            (contains_substring ~needle:"TA Dashboard" result.stdout)))

let expect_socket_launch_dry_run () =
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
                "--config";
                fixture "ta-valid.json";
                "launch-dry-run";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "new session command" true
            (contains_substring ~needle:"tmux new-session -d -P -F '#{pane_id}'"
               result.stdout);
          Alcotest.(check bool)
            "split command" true
            (contains_substring
               ~needle:"tmux split-window -d -P -F '#{pane_id}' -t ta-fixture"
               result.stdout)))

let expect_socket_launch_dry_run_absolutizes_config () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      with_socket_server ~server_cwd:"/" ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [
                "socket";
                "request";
                "--socket";
                socket_path;
                "--config";
                fixture "ta-valid.json";
                "launch-dry-run";
              ]
          in
          check_exit "request exit" 0 result.status;
          Alcotest.(check string) "request stderr" "" result.stderr;
          Alcotest.(check bool)
            "server loaded client-relative config" true
            (contains_substring ~needle:"tmux new-session -d -P -F '#{pane_id}'"
               result.stdout)))

let expect_socket_launch_requires_config () =
  with_temp_dir (fun dir ->
      let socket_path = Filename.concat dir "ta.sock" in
      let result =
        run_tactl
          [ "socket"; "request"; "--socket"; socket_path; "launch-dry-run" ]
      in
      check_exit "request exit" 2 result.status;
      Alcotest.(check bool)
        "config required" true
        (contains_substring
           ~needle:"--config is required for this socket command" result.stderr))

let expect_socket_launch_start_requires_actor () =
  with_temp_dir (fun dir ->
      let socket_path = Filename.concat dir "ta.sock" in
      let result =
        run_tactl
          [
            "socket";
            "request";
            "--socket";
            socket_path;
            "--config";
            fixture "ta-valid.json";
            "launch-start";
          ]
      in
      check_exit "request exit" 2 result.status;
      Alcotest.(check bool)
        "actor required" true
        (contains_substring ~needle:"--actor is required for launch-start"
           result.stderr))

let expect_socket_launch_start_rejects_unauthorized_actor () =
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
                "--config";
                fixture "ta-valid.json";
                "--actor";
                "lead";
                "launch-start";
              ]
          in
          check_exit "request exit" 1 result.status;
          Alcotest.(check bool)
            "write denied before launch" true
            (contains_substring ~needle:"actor lead cannot write agent qa"
               result.stderr)))

let expect_socket_launch_rejects_non_regular_config () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      let fifo_path = Filename.concat dir "config.fifo" in
      save_state state_path;
      Unix.mkfifo fifo_path 0o600;
      with_socket_server ~state_path ~socket_path (fun () ->
          let result =
            run_tactl
              [
                "socket";
                "request";
                "--socket";
                socket_path;
                "--config";
                fifo_path;
                "launch-dry-run";
              ]
          in
          check_exit "request exit" 1 result.status;
          Alcotest.(check bool)
            "fifo rejected" true
            (contains_substring ~needle:"expected a regular file" result.stderr)))

let expect_socket_rejects_unauthorized_actor () =
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
                "--workspace";
                "fixture";
                "--agent";
                "qa";
                "--status";
                "running";
                "--actor";
                "lead";
                "set-status";
              ]
          in
          check_exit "request exit" 1 result.status;
          Alcotest.(check bool)
            "write denied" true
            (contains_substring ~needle:"actor lead cannot write agent qa"
               result.stderr));
      let show =
        run_tactl [ "state"; "show"; "--audit-limit"; "2"; state_path ]
      in
      check_exit "show exit" 0 show.status;
      Alcotest.(check bool)
        "qa unchanged" true
        (contains_substring ~needle:"- qa [not-started]" show.stdout);
      Alcotest.(check bool)
        "no status audit" false
        (contains_substring ~needle:"status qa:" show.stdout))

let expect_socket_rejects_missing_actor () =
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
                "--workspace";
                "fixture";
                "--agent";
                "lead";
                "--status";
                "running";
                "set-status";
              ]
          in
          check_exit "request exit" 1 result.status;
          Alcotest.(check bool)
            "actor required" true
            (contains_substring ~needle:"actor is required for socket mutations"
               result.stderr)))

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

let expect_socket_refuses_shared_directory () =
  with_temp_dir_mode 0o755 (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
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
        "directory rejected" true
        (contains_substring
           ~needle:"socket directory must not be accessible by group or others"
           result.stderr))

let expect_socket_file_mode_is_owner_only () =
  with_temp_dir (fun dir ->
      let state_path = Filename.concat dir "state.json" in
      let socket_path = Filename.concat dir "ta.sock" in
      save_state state_path;
      with_socket_server ~state_path ~socket_path (fun () ->
          Alcotest.(check int) "socket mode" 0o600 (socket_mode socket_path);
          let result =
            run_tactl
              [ "socket"; "request"; "--socket"; socket_path; "state-summary" ]
          in
          check_exit "request exit" 0 result.status))

let () =
  Alcotest.run "tactl-socket-cli"
    [
      ( "socket",
        [
          Alcotest.test_case "state summary" `Quick expect_socket_state_summary;
          Alcotest.test_case "state show" `Quick expect_socket_state_show;
          Alcotest.test_case "set status" `Quick expect_socket_set_status;
          Alcotest.test_case "attach pane" `Quick expect_socket_attach_pane;
          Alcotest.test_case "runtime snapshot" `Quick
            expect_socket_runtime_snapshot;
          Alcotest.test_case "runtime snapshot requires actor" `Quick
            expect_socket_runtime_snapshot_requires_actor;
          Alcotest.test_case "runtime snapshot rejects unauthorized actor"
            `Quick expect_socket_runtime_snapshot_rejects_unauthorized_actor;
          Alcotest.test_case "runtime snapshot rejects bad lines" `Quick
            expect_socket_runtime_snapshot_rejects_bad_lines;
          Alcotest.test_case "runtime snapshot rejects large lines" `Quick
            expect_socket_runtime_snapshot_rejects_large_lines;
          Alcotest.test_case "dashboard snapshot actor scoped" `Quick
            expect_socket_dashboard_snapshot_actor_scoped;
          Alcotest.test_case "dashboard snapshot requires actor" `Quick
            expect_socket_dashboard_snapshot_requires_actor;
          Alcotest.test_case "dashboard snapshot rejects unknown actor" `Quick
            expect_socket_dashboard_snapshot_rejects_unknown_actor;
          Alcotest.test_case "dashboard render socket" `Quick
            expect_dashboard_render_socket;
          Alcotest.test_case "dashboard actions socket" `Quick
            expect_dashboard_actions_socket;
          Alcotest.test_case "dashboard actions socket write-only target" `Quick
            expect_dashboard_actions_socket_exports_write_only_target;
          Alcotest.test_case "dashboard actions socket requires actor" `Quick
            expect_dashboard_actions_socket_requires_actor;
          Alcotest.test_case "dashboard render socket uses roster index" `Quick
            expect_dashboard_render_socket_uses_roster_index;
          Alcotest.test_case "dashboard render socket redacts pipeline overview"
            `Quick expect_dashboard_render_socket_redacts_pipeline_overview;
          Alcotest.test_case "dashboard render socket stale refresh" `Quick
            expect_dashboard_render_socket_refresh_failure_is_stale;
          Alcotest.test_case "launch dry run" `Quick
            expect_socket_launch_dry_run;
          Alcotest.test_case "launch dry run absolutizes config" `Quick
            expect_socket_launch_dry_run_absolutizes_config;
          Alcotest.test_case "launch requires config" `Quick
            expect_socket_launch_requires_config;
          Alcotest.test_case "launch start requires actor" `Quick
            expect_socket_launch_start_requires_actor;
          Alcotest.test_case "launch start rejects unauthorized actor" `Quick
            expect_socket_launch_start_rejects_unauthorized_actor;
          Alcotest.test_case "launch rejects non-regular config" `Quick
            expect_socket_launch_rejects_non_regular_config;
          Alcotest.test_case "rejects unauthorized actor" `Quick
            expect_socket_rejects_unauthorized_actor;
          Alcotest.test_case "rejects missing actor" `Quick
            expect_socket_rejects_missing_actor;
          Alcotest.test_case "unknown command" `Quick
            expect_socket_unknown_command;
          Alcotest.test_case "negative audit limit" `Quick
            expect_socket_negative_audit_limit;
          Alcotest.test_case "refuses regular file path" `Quick
            expect_socket_refuses_regular_file_path;
          Alcotest.test_case "refuses shared directory" `Quick
            expect_socket_refuses_shared_directory;
          Alcotest.test_case "socket mode is owner only" `Quick
            expect_socket_file_mode_is_owner_only;
        ] );
    ]
