#!/usr/bin/env node
// Entry module for the roster extension installer. The implementation lives in
// scripts/extension/ (cli/manifest/planner/transaction/registry); this file
// keeps the stable public surface: the five exports consumed by tests and the
// CLI entrypoint referenced by package.json and roster-extension.sh.
export { info, install, list, remove, converge, parseArgs } from "./extension/cli.js";

import { CliUsageError, main } from "./extension/cli.js";

if (require.main === module) {
  main().catch((error: Error) => {
    const exitCode = error instanceof CliUsageError ? error.exitCode : 1;
    const message = error instanceof CliUsageError ? error.message : `✗ roster-extension: ${error.message}`;
    if (exitCode === 0) console.log(message);
    else console.error(message);
    process.exitCode = exitCode;
  });
}
