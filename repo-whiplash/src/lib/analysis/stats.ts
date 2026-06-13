// Pure numeric helpers shared by metric reducers.

export function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function percent(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return (part / whole) * 100;
}

export function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

// % change between two values (the report's headline framing).
export function pctChange(low: number | null, high: number | null): number | null {
  if (low === null || high === null || low === 0) return null;
  return ((high - low) / Math.abs(low)) * 100;
}

const DAY = 86_400_000;
export const ms = { hours: (n: number) => n * 3_600_000, days: (n: number) => n * DAY };
export const toHours = (msVal: number) => msVal / 3_600_000;

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

// Distinct count of a mapped key over a list.
export function distinct<T>(xs: T[], key: (x: T) => string | null | undefined): number {
  const set = new Set<string>();
  for (const x of xs) {
    const k = key(x);
    if (k) set.add(k);
  }
  return set.size;
}
