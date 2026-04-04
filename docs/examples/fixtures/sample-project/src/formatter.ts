/**
 * Formats an array of string items for display.
 *
 * BUG: line 14 uses item.length instead of i + 1 for row numbers.
 * Every row in table output gets the same number (the string length
 * of that item), making row numbering meaningless.
 *
 * SILENT FAILURE: unknown format values return "" with no error.
 */

export function formatOutput(items: string[], format: string): string {
  if (format === "table") {
    const rows = items.map((item, i) => {
      // BUG: should be `i + 1` — item.length gives the string length, not row number
      const rowNum = item.length;
      return `${rowNum}. ${item}`;
    });
    return rows.join("\n");
  }

  if (format === "json") {
    return JSON.stringify(items, null, 2);
  }

  // Silent failure: unknown format returns empty string instead of throwing.
  // The reviewer should flag this as a missing guard.
  return "";
}
