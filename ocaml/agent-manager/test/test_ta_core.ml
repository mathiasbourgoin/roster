let valid_config =
  {|
{
  "version": "0.1.0",
  "workspaces": [
    {
      "id": "agent-roster",
      "label": "Agent Roster",
      "root": ".",
      "harness_path": ".harness/harness.json",
      "tmux_session": "ta-agent-roster",
      "default_view": "agents",
      "views": [
        {"id": "agents", "label": "Agents"},
        {"id": "qa", "label": "QA"}
      ],
      "agents": [
        {
          "name": "tech-lead",
          "roster_agent": "tech-lead",
          "command": ["codex"],
          "cwd": ".",
          "env": [{"name": "TA_MODE", "value": "lead"}]
        },
        {
          "name": "qa",
          "roster_agent": "qa",
          "command": ["codex"],
          "cwd": "."
        }
      ],
      "links": [
        {
          "from": "tech-lead",
          "to": "qa",
          "permissions": ["read", "write"],
          "reason": "lead routes verification requests"
        }
      ]
    }
  ]
}
|}

let expect_valid () =
  match Ta_core.Workspace_config.parse_string valid_config with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config ->
      Alcotest.(check int) "workspace count" 1 (List.length config.workspaces);
      Alcotest.(check int)
        "validation errors" 0
        (List.length (Ta_core.Workspace_config.validate config))

let expect_invalid_link () =
  let text =
    String.concat "\n"
      [
        "{";
        {|  "version": "0.1.0",|};
        {|  "workspaces": [|};
        {|    {|};
        {|      "id": "w",|};
        {|      "label": "W",|};
        {|      "root": ".",|};
        {|      "tmux_session": "ta-w",|};
        {|      "default_view": "agents",|};
        {|      "views": [{"id": "agents", "label": "Agents"}],|};
        {|      "agents": [{"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]}],|};
        {|      "links": [{"from": "lead", "to": "ghost", "permissions": ["read"], "reason": "test"}]|};
        {|    }|};
        {|  ]|};
        "}";
      ]
  in
  match Ta_core.Workspace_config.parse_string text with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config ->
      let errors = Ta_core.Workspace_config.validate config in
      Alcotest.(check int) "one validation error" 1 (List.length errors)

let expect_duplicate_agent () =
  let text =
    String.concat "\n"
      [
        "{";
        {|  "version": "0.1.0",|};
        {|  "workspaces": [|};
        {|    {|};
        {|      "id": "w",|};
        {|      "label": "W",|};
        {|      "root": ".",|};
        {|      "tmux_session": "ta-w",|};
        {|      "default_view": "agents",|};
        {|      "views": [{"id": "agents", "label": "Agents"}],|};
        {|      "agents": [|};
        {|        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]},|};
        {|        {"name": "lead", "roster_agent": "reviewer", "command": ["codex"]}|};
        {|      ]|};
        {|    }|};
        {|  ]|};
        "}";
      ]
  in
  match Ta_core.Workspace_config.parse_string text with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Workspace_config.error_to_string errors))
  | Ok config ->
      let errors = Ta_core.Workspace_config.validate config in
      Alcotest.(check bool) "has validation error" true (errors <> [])

let expect_invalid_tmux_session () =
  let text =
    String.concat "\n"
      [
        "{";
        {|  "version": "0.1.0",|};
        {|  "workspaces": [|};
        {|    {|};
        {|      "id": "w",|};
        {|      "label": "W",|};
        {|      "root": ".",|};
        {|      "tmux_session": "bad session",|};
        {|      "default_view": "agents",|};
        {|      "views": [{"id": "agents", "label": "Agents"}],|};
        {|      "agents": [{"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]}]|};
        {|    }|};
        {|  ]|};
        "}";
      ]
  in
  match Ta_core.Workspace_config.parse_string text with
  | Ok _ -> Alcotest.fail "invalid tmux session should fail parse"
  | Error errors ->
      Alcotest.(check int) "one parse error" 1 (List.length errors)

let expect_missing_file_is_result () =
  match Ta_core.Workspace_config.load "/tmp/ta-definitely-missing.json" with
  | Ok _ -> Alcotest.fail "missing file should fail"
  | Error errors -> Alcotest.(check int) "one load error" 1 (List.length errors)

let expect_unknown_permission () =
  let text =
    String.concat "\n"
      [
        "{";
        {|  "version": "0.1.0",|};
        {|  "workspaces": [|};
        {|    {|};
        {|      "id": "w",|};
        {|      "label": "W",|};
        {|      "root": ".",|};
        {|      "tmux_session": "ta-w",|};
        {|      "default_view": "agents",|};
        {|      "views": [{"id": "agents", "label": "Agents"}],|};
        {|      "agents": [|};
        {|        {"name": "lead", "roster_agent": "tech-lead", "command": ["codex"]},|};
        {|        {"name": "qa", "roster_agent": "qa", "command": ["codex"]}|};
        {|      ],|};
        {|      "links": [{"from": "lead", "to": "qa", "permissions": ["admin"], "reason": "test"}]|};
        {|    }|};
        {|  ]|};
        "}";
      ]
  in
  match Ta_core.Workspace_config.parse_string text with
  | Ok _ -> Alcotest.fail "unknown permission should fail parse"
  | Error errors ->
      Alcotest.(check int) "one parse error" 1 (List.length errors)

let expect_roster_index_parse () =
  let text =
    {|
[
  {"name": "tech-lead", "display_name": "Tech Lead", "description": "Lead work", "domain": ["management"], "tags": ["planning"], "model": "opus", "complexity": "high", "compatible_with": ["claude-code"], "version": "1.9.0", "author": "mathias", "isolation": "none", "path": "agents/management/tech-lead.md", "source": "local", "component_type": "agent"},
  {"name": "not-an-agent", "component_type": "skill"}
]
|}
  in
  match Ta_core.Roster_index.parse_string text with
  | Error errors ->
      Alcotest.fail
        (String.concat "\n"
           (List.map Ta_core.Roster_index.error_to_string errors))
  | Ok roster ->
      Alcotest.(check bool)
        "has tech-lead" true
        (Ta_core.Roster_index.mem_agent roster "tech-lead");
      let entry =
        match Ta_core.Roster_index.find_agent roster "tech-lead" with
        | Some entry -> entry
        | None -> Alcotest.fail "missing tech-lead"
      in
      Alcotest.(check string)
        "display" "Tech Lead"
        (Option.value entry.display_name ~default:"");
      Alcotest.(check (list string)) "domain" [ "management" ] entry.domain;
      Alcotest.(check (list string)) "tags" [ "planning" ] entry.tags;
      Alcotest.(check string)
        "model" "opus"
        (Option.value entry.model ~default:"");
      Alcotest.(check string)
        "complexity" "high"
        (Option.value entry.complexity ~default:"");
      Alcotest.(check (list string))
        "compatible" [ "claude-code" ] entry.compatible_with;
      Alcotest.(check string)
        "version" "1.9.0"
        (Option.value entry.version ~default:"");
      Alcotest.(check string)
        "author" "mathias"
        (Option.value entry.author ~default:"");
      Alcotest.(check string)
        "isolation" "none"
        (Option.value entry.isolation ~default:"");
      Alcotest.(check bool)
        "filters skill" false
        (Ta_core.Roster_index.mem_agent roster "not-an-agent")

let expect_roster_frontmatter_parse () =
  let text =
    "---\r\n\
     name: tech-lead\r\n\
     domain: [old]\r\n\
     domain: [management, orchestration]\r\n\
     model: haiku\r\n\
     model: 'opus'\r\n\
     pipeline_role:\r\n\
    \  triggered_by: user\r\n\
     ---\r\n\
     # Body\r\n"
  in
  match Ta_core.Roster_frontmatter.parse_string text with
  | None -> Alcotest.fail "frontmatter should parse"
  | Some frontmatter ->
      Alcotest.(check string)
        "scalar" "opus"
        (Option.value
           (Ta_core.Roster_frontmatter.find_scalar "model" frontmatter)
           ~default:"");
      Alcotest.(check (list string))
        "inline list last wins"
        [ "management"; "orchestration" ]
        (Option.value
           (Ta_core.Roster_frontmatter.find_list "domain" frontmatter)
           ~default:[]);
      Alcotest.(check bool)
        "nested field ignored" true
        (Option.is_none
           (Ta_core.Roster_frontmatter.find_scalar "triggered_by" frontmatter))

let expect_roster_frontmatter_rejects_missing_markers () =
  Alcotest.(check bool)
    "missing opening marker" true
    (Option.is_none
       (Ta_core.Roster_frontmatter.parse_string "name: tech-lead\n---\n# Body\n"));
  Alcotest.(check bool)
    "missing closing marker" true
    (Option.is_none
       (Ta_core.Roster_frontmatter.parse_string "---\nname: tech-lead\n# Body\n"))

let write_temp_file contents =
  let path, channel = Filename.open_temp_file "ta-frontmatter" ".md" in
  Fun.protect
    ~finally:(fun () -> close_out_noerr channel)
    (fun () -> output_string channel contents);
  path

let expect_roster_index_frontmatter_enrichment () =
  let frontmatter_path =
    write_temp_file
      {|---
name: tech-lead
display_name: Tech Lead FM
description: Frontmatter lead role.
domain: [management, orchestration]
tags: [team-lead, qa]
model: opus
complexity: high
compatible_with: [claude-code, codex]
version: 9.9.9
author: mathias
isolation: none
pipeline_role:
  triggered_by: test
---
# Body
|}
  in
  Fun.protect
    ~finally:(fun () ->
      try Sys.remove frontmatter_path with Sys_error _ -> ())
    (fun () ->
      let text =
        Printf.sprintf
          {|[{"name": "tech-lead", "display_name": "Tech Lead", "description": "Old", "path": %S, "source": "local", "component_type": "agent"}]|}
          (Filename.basename frontmatter_path)
      in
      match Ta_core.Roster_index.parse_string text with
      | Error errors ->
          Alcotest.fail
            (String.concat "\n"
               (List.map Ta_core.Roster_index.error_to_string errors))
      | Ok roster ->
          let roster =
            Ta_core.Roster_index.enrich_from_frontmatter
              ~root:(Filename.dirname frontmatter_path)
              roster
          in
          let entry =
            match Ta_core.Roster_index.find_agent roster "tech-lead" with
            | Some entry -> entry
            | None -> Alcotest.fail "missing tech-lead"
          in
          Alcotest.(check string)
            "display" "Tech Lead FM"
            (Option.value entry.display_name ~default:"");
          Alcotest.(check string)
            "description" "Frontmatter lead role."
            (Option.value entry.description ~default:"");
          Alcotest.(check (list string))
            "domain"
            [ "management"; "orchestration" ]
            entry.domain;
          Alcotest.(check (list string)) "tags" [ "team-lead"; "qa" ] entry.tags;
          Alcotest.(check string)
            "model" "opus"
            (Option.value entry.model ~default:"");
          Alcotest.(check string)
            "complexity" "high"
            (Option.value entry.complexity ~default:"");
          Alcotest.(check (list string))
            "compatible" [ "claude-code"; "codex" ] entry.compatible_with;
          Alcotest.(check string)
            "version" "9.9.9"
            (Option.value entry.version ~default:"");
          Alcotest.(check string)
            "author" "mathias"
            (Option.value entry.author ~default:"");
          Alcotest.(check string)
            "isolation" "none"
            (Option.value entry.isolation ~default:""))

let expect_roster_index_frontmatter_requires_local_match () =
  let matching_path =
    write_temp_file
      {|---
name: tech-lead
display_name: From Markdown
model: opus
---
|}
  in
  let mismatch_path =
    write_temp_file
      {|---
name: qa
display_name: Wrong Markdown
model: haiku
---
|}
  in
  Fun.protect
    ~finally:(fun () ->
      List.iter
        (fun path -> try Sys.remove path with Sys_error _ -> ())
        [ matching_path; mismatch_path ])
    (fun () ->
      let text =
        Printf.sprintf
          {|
[
  {"name": "remote-lead", "display_name": "Remote Lead", "path": %S, "source": "remote", "component_type": "agent"},
  {"name": "absolute-lead", "display_name": "Absolute Lead", "path": %S, "source": "local", "component_type": "agent"},
  {"name": "parent-lead", "display_name": "Parent Lead", "path": "../outside.md", "source": "local", "component_type": "agent"},
  {"name": "tech-lead", "display_name": "Tech Lead", "path": %S, "source": "local", "component_type": "agent"}
]
|}
          (Filename.basename matching_path)
          matching_path
          (Filename.basename mismatch_path)
      in
      match Ta_core.Roster_index.parse_string text with
      | Error errors ->
          Alcotest.fail
            (String.concat "\n"
               (List.map Ta_core.Roster_index.error_to_string errors))
      | Ok roster ->
          let roster =
            Ta_core.Roster_index.enrich_from_frontmatter
              ~root:(Filename.dirname matching_path)
              roster
          in
          let remote =
            match Ta_core.Roster_index.find_agent roster "remote-lead" with
            | Some entry -> entry
            | None -> Alcotest.fail "missing remote-lead"
          in
          let local =
            match Ta_core.Roster_index.find_agent roster "tech-lead" with
            | Some entry -> entry
            | None -> Alcotest.fail "missing tech-lead"
          in
          let absolute =
            match Ta_core.Roster_index.find_agent roster "absolute-lead" with
            | Some entry -> entry
            | None -> Alcotest.fail "missing absolute-lead"
          in
          let parent =
            match Ta_core.Roster_index.find_agent roster "parent-lead" with
            | Some entry -> entry
            | None -> Alcotest.fail "missing parent-lead"
          in
          Alcotest.(check string)
            "remote skipped" "Remote Lead"
            (Option.value remote.display_name ~default:"");
          Alcotest.(check string)
            "absolute skipped" "Absolute Lead"
            (Option.value absolute.display_name ~default:"");
          Alcotest.(check string)
            "parent skipped" "Parent Lead"
            (Option.value parent.display_name ~default:"");
          Alcotest.(check string)
            "mismatch skipped" "Tech Lead"
            (Option.value local.display_name ~default:"");
          Alcotest.(check bool)
            "mismatch model skipped" true
            (Option.is_none local.model))

let expect_unknown_roster_agent () =
  let roster =
    match
      Ta_core.Roster_index.parse_string
        {|[{"name": "tech-lead", "component_type": "agent"}]|}
    with
    | Ok roster -> roster
    | Error _ -> Alcotest.fail "roster should parse"
  in
  match Ta_core.Workspace_config.parse_string valid_config with
  | Error _ -> Alcotest.fail "config should parse"
  | Ok config ->
      let errors =
        Ta_core.Workspace_config.validate_with_roster ~roster config
      in
      Alcotest.(check int) "unknown qa roster agent" 1 (List.length errors)

let expect_bad_id () =
  (match Ta_core.Id.Agent.of_string "bad id" with
  | Ok _ -> Alcotest.fail "bad id should be rejected"
  | Error _ -> ());
  match Ta_core.Id.Pane.of_string "%77" with
  | Ok pane ->
      Alcotest.(check string)
        "tmux pane id" "%77"
        (Ta_core.Id.Pane.to_string pane)
  | Error message -> Alcotest.fail message

let expect_tmux_argv () =
  let target = Ta_core.Tmux.unsafe_target_of_string "ta-test" in
  Alcotest.(check (list string))
    "capture argv"
    [ "capture-pane"; "-p"; "-t"; "ta-test"; "-S"; "-40" ]
    (Ta_core.Tmux.argv (Ta_core.Tmux.Capture_pane { target; lines = 40 }))

let expect_tmux_quotes_command () =
  let session = Ta_core.Tmux.unsafe_session_of_string "ta-test" in
  Alcotest.(check (list string))
    "new-session argv"
    [
      "new-session";
      "-d";
      "-s";
      "ta-test";
      "-c";
      "/tmp/project";
      "'printf' 'it'\\''s ok'";
    ]
    (Ta_core.Tmux.argv
       (Ta_core.Tmux.New_detached_session
          {
            session;
            cwd = Some "/tmp/project";
            command = [ "printf"; "it's ok" ];
          }))

let expect_tmux_launch_argv () =
  let target = Ta_core.Tmux.unsafe_target_of_string "ta-test:0" in
  Alcotest.(check (list string))
    "split argv"
    [
      "split-window";
      "-d";
      "-t";
      "ta-test:0";
      "-c";
      "/tmp/project";
      "'env' 'ROLE=qa' 'codex'";
    ]
    (Ta_core.Tmux.argv
       (Ta_core.Tmux.Split_window
          {
            target;
            cwd = Some "/tmp/project";
            command = [ "env"; "ROLE=qa"; "codex" ];
          }));
  Alcotest.(check (list string))
    "layout argv"
    [ "select-layout"; "-t"; "ta-test:0"; "tiled" ]
    (Ta_core.Tmux.argv
       (Ta_core.Tmux.Select_layout { target; layout = "tiled" }))

let expect_tmux_capture_pane_id_argv () =
  let session = Ta_core.Tmux.unsafe_session_of_string "ta-test" in
  let target = Ta_core.Tmux.unsafe_target_of_string "ta-test" in
  Alcotest.(check (list string))
    "new session with pane id argv"
    [
      "new-session";
      "-d";
      "-P";
      "-F";
      "#{pane_id}";
      "-s";
      "ta-test";
      "-c";
      "/tmp/project";
      "'codex'";
    ]
    (Ta_core.Tmux.argv
       (Ta_core.Tmux.New_detached_session_with_pane_id
          { session; cwd = Some "/tmp/project"; command = [ "codex" ] }));
  Alcotest.(check (list string))
    "split with pane id argv"
    [
      "split-window";
      "-d";
      "-P";
      "-F";
      "#{pane_id}";
      "-t";
      "ta-test";
      "-c";
      "/tmp/project";
      "'codex'";
    ]
    (Ta_core.Tmux.argv
       (Ta_core.Tmux.Split_window_with_pane_id
          { target; cwd = Some "/tmp/project"; command = [ "codex" ] }))

let expect_tmux_pane_id_argv () =
  let target = Ta_core.Tmux.unsafe_target_of_string "ta-test:0.1" in
  Alcotest.(check (list string))
    "pane id argv"
    [ "display-message"; "-p"; "-t"; "ta-test:0.1"; "#{pane_id}" ]
    (Ta_core.Tmux.argv (Ta_core.Tmux.Display_pane_id target));
  Alcotest.(check string)
    "pane id command line" "tmux display-message -p -t ta-test:0.1 '#{pane_id}'"
    (Ta_core.Tmux.command_line (Ta_core.Tmux.Display_pane_id target))

let expect_tmux_session_name_argv () =
  let target = Ta_core.Tmux.unsafe_target_of_string "%11" in
  Alcotest.(check (list string))
    "session name argv"
    [ "display-message"; "-p"; "-t"; "%11"; "#{session_name}" ]
    (Ta_core.Tmux.argv (Ta_core.Tmux.Display_session_name target));
  Alcotest.(check string)
    "session name command line"
    "tmux display-message -p -t %11 '#{session_name}'"
    (Ta_core.Tmux.command_line (Ta_core.Tmux.Display_session_name target))

let expect_tmux_pane_identity_argv () =
  let target = Ta_core.Tmux.unsafe_target_of_string "%11" in
  Alcotest.(check (list string))
    "pane identity argv"
    [ "display-message"; "-p"; "-t"; "%11"; "#{session_id}\t#{window_id}" ]
    (Ta_core.Tmux.argv (Ta_core.Tmux.Display_pane_identity target));
  Alcotest.(check bool)
    "parse identity" true
    (match Ta_core.Tmux.parse_pane_identity "$1\t@2\n" with
    | Ok identity ->
        String.equal "$1" identity.session_id
        && String.equal "@2" identity.window_id
    | Error _ -> false)

let () =
  Alcotest.run "ta-core"
    [
      ( "workspace_config",
        [
          Alcotest.test_case "valid config" `Quick expect_valid;
          Alcotest.test_case "invalid link" `Quick expect_invalid_link;
          Alcotest.test_case "duplicate agent" `Quick expect_duplicate_agent;
          Alcotest.test_case "invalid tmux session" `Quick
            expect_invalid_tmux_session;
          Alcotest.test_case "missing file result" `Quick
            expect_missing_file_is_result;
          Alcotest.test_case "unknown permission" `Quick
            expect_unknown_permission;
        ] );
      ("id", [ Alcotest.test_case "bad id" `Quick expect_bad_id ]);
      ( "roster_index",
        [
          Alcotest.test_case "parse agents" `Quick expect_roster_index_parse;
          Alcotest.test_case "parse frontmatter" `Quick
            expect_roster_frontmatter_parse;
          Alcotest.test_case "frontmatter marker rejection" `Quick
            expect_roster_frontmatter_rejects_missing_markers;
          Alcotest.test_case "frontmatter enrichment" `Quick
            expect_roster_index_frontmatter_enrichment;
          Alcotest.test_case "frontmatter local name match" `Quick
            expect_roster_index_frontmatter_requires_local_match;
          Alcotest.test_case "unknown roster agent" `Quick
            expect_unknown_roster_agent;
        ] );
      ( "tmux",
        [
          Alcotest.test_case "argv" `Quick expect_tmux_argv;
          Alcotest.test_case "quotes command" `Quick expect_tmux_quotes_command;
          Alcotest.test_case "launch argv" `Quick expect_tmux_launch_argv;
          Alcotest.test_case "capture pane id argv" `Quick
            expect_tmux_capture_pane_id_argv;
          Alcotest.test_case "pane id argv" `Quick expect_tmux_pane_id_argv;
          Alcotest.test_case "session name argv" `Quick
            expect_tmux_session_name_argv;
          Alcotest.test_case "pane identity argv" `Quick
            expect_tmux_pane_identity_argv;
        ] );
    ]
