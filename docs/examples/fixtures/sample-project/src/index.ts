/**
 * sample-cli — prints a numbered list of items.
 *
 * Usage:
 *   node dist/src/index.js [--count N] [--format table|json]
 */

import { parseArgs } from "./parser.js";
import { formatOutput } from "./formatter.js";

const ITEMS: string[] = [
  "apple",
  "banana",
  "cherry",
  "date",
  "elderberry",
  "fig",
  "grape",
  "honeydew",
  "kiwi",
  "lemon",
];

function main(): void {
  const { count, format } = parseArgs(process.argv);

  const selected = ITEMS.slice(0, count);

  if (selected.length === 0) {
    console.error("No items to display.");
    process.exit(1);
  }

  const output = formatOutput(selected, format);
  console.log(output);
}

main();
