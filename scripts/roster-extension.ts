#!/usr/bin/env node
// Entry module for the roster extension installer. The implementation lives in
// scripts/extension/ (cli/manifest/planner/transaction/registry); this file
// keeps the stable public surface: the five exports consumed by tests and the
// CLI entrypoint referenced by package.json and roster-extension.sh.
export { info, install, list, remove, converge } from "./extension/cli.js";

import { main } from "./extension/cli.js";

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(`✗ roster-extension: ${error.message}`);
    process.exit(1);
  });
}
