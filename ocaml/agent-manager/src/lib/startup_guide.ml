let text =
  String.concat "\n"
    [
      "TA quickstart";
      "";
      "Start the dashboard from ocaml/agent-manager:";
      "  dune exec ta";
      "Installed app entrypoint:";
      "  ta";
      "";
      "Default lookup order:";
      "  state: "
      ^ Startup_paths.describe_candidates Startup_paths.state_candidates;
      "  config: "
      ^ Startup_paths.describe_candidates Startup_paths.config_candidates;
      "";
      "Real workspace setup:";
      "  mkdir -p .harness";
      "  cp /path/to/your-ta.json .harness/ta.json";
      "  dune exec tactl -- state save --output .ta-state.json .harness/ta.json";
      "  dune exec tactl -- launch start --state .ta-state.json \
       .harness/ta.json";
      "  dune exec ta";
      "";
      "Bundled example setup:";
      "  # The bundled example has root \".\", so copy it to ta.json unchanged.";
      "  cp examples/ta.example.json ta.json";
      "  # From the repository root, use:";
      "  # cp ocaml/agent-manager/examples/ta.example.json ta.json";
      "  dune exec tactl -- state save --output .ta-state.json ta.json";
      "  dune exec tactl -- launch start --state .ta-state.json ta.json";
      "  dune exec ta";
      "";
      "Installed real-workspace commands:";
      "  tactl state save --output .ta-state.json .harness/ta.json";
      "  tactl launch start --state .ta-state.json .harness/ta.json";
      "  ta";
      "";
      "Socket-backed dashboard:";
      "  tactl socket serve --socket /tmp/ta.sock --state .ta-state.json";
      "  tactl dashboard render-socket --socket /tmp/ta.sock --actor <agent>";
      "";
      "Current TUI status:";
      "  The ta entrypoint uses the miaou-tui terminal runner for full-screen \
       dashboard mode.";
      "  Set MIAOU_DRIVER=headless to drive the TUI with JSON commands in \
       automation.";
      "";
      "Dashboard keys:";
      "  p: pipeline focus";
      "  Right/Left: cycle ACL edges";
      "  [ and ]: cycle focused edge targets";
      "  r: refresh when a refresh source is available";
    ]
