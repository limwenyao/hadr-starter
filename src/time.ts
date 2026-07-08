/**
 * Time helpers. Event times are epoch milliseconds UTC. JS `Date` only spans
 * ±8.64e15 ms (ECMA-262); outside that — or NaN/Infinity — `toISOString()`
 * throws RangeError. A single malformed feed timestamp must never crash the
 * whole run (never fail silently, never crash — CLAUDE.md #4), so time formatting
 * goes through here.
 */

/** Largest magnitude epoch-ms `new Date(ms)` can represent (ECMA-262). */
export const MAX_EVENT_TIME_MS = 8.64e15;

/** True when `new Date(ms).toISOString()` is safe to call on `ms`. */
export function isValidEventTime(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= MAX_EVENT_TIME_MS;
}

/** Safe UTC-ISO formatter: never throws; degrades to a marker on bad input. */
export function formatUtc(ms: number): string {
  return isValidEventTime(ms) ? new Date(ms).toISOString() : "time unavailable";
}
