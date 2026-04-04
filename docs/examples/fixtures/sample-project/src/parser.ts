/**
 * Parses CLI arguments into structured options.
 *
 * BUG: line 21 uses argv.slice(1) instead of argv.slice(2).
 * process.argv is [node, script, ...args], so slicing at 1
 * includes the script path as the first "argument", causing
 * the first real flag to be silently ignored or misread.
 */

const DEFAULT_COUNT = 10;
const VALID_FORMATS = ["table", "json"] as const;
type Format = (typeof VALID_FORMATS)[number];

export interface ParsedArgs {
  count: number;
  format: Format;
}

export function parseArgs(argv: string[]): ParsedArgs {
  // BUG: should be argv.slice(2) to skip [node, script]
  const args = argv.slice(1);

  let count = DEFAULT_COUNT;
  let format: Format = "table";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count") {
      const raw = args[i + 1];
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`Invalid --count value: ${raw}`);
      }
      count = n;
      i++;
    } else if (args[i] === "--format") {
      const raw = args[i + 1] as Format;
      if (!VALID_FORMATS.includes(raw)) {
        throw new Error(`Invalid --format value: ${raw}`);
      }
      format = raw;
      i++;
    }
  }

  return { count, format };
}
