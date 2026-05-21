open Cmdliner

let dashboard config_path =
  match config_path with
  | None ->
      print_endline "TA bootstrap dashboard";
      print_endline "No config provided. Pass --config .harness/ta.json.";
      `Ok 0
  | Some path -> (
      match Ta_core.Workspace_config.load path with
      | Error errors ->
          List.iter
            (fun error ->
              prerr_endline (Ta_core.Workspace_config.error_to_string error))
            errors;
          `Ok 1
      | Ok config ->
          let errors = Ta_core.Workspace_config.validate config in
          if errors = [] then (
            print_endline "TA bootstrap dashboard";
            print_endline (Ta_core.Workspace_config.summarize config);
            print_endline "MIAOU TUI layer: planned next milestone.";
            `Ok 0)
          else (
            List.iter
              (fun error ->
                prerr_endline (Ta_core.Workspace_config.error_to_string error))
              errors;
            `Ok 1))

let config_arg =
  Arg.(
    value
    & opt (some file) None
    & info [ "config"; "c" ] ~docv:"CONFIG" ~doc:"TA workspace config")

let root_cmd =
  let doc = "Launch the TA roster-agent workspace manager." in
  Cmd.v
    (Cmd.info "ta" ~version:"0.1.0" ~doc)
    Term.(ret (const dashboard $ config_arg))

let () = exit (Cmd.eval' root_cmd)
