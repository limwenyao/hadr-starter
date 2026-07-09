import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SitrepModel } from "./types.js";

/**
 * Dated JSON snapshots (ADR 0006): each run persists its assessed SitrepModel
 * as data/YYYY-MM-DD.json; git history is the audit trail. The prior snapshot
 * feeds change detection (ADR 0009). No database, single daily writer.
 *
 * Read failures (missing dir, no prior file, corrupt JSON) degrade to null —
 * the run continues without change notes rather than crashing (CLAUDE.md #4).
 */

const SNAPSHOT_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

/**
 * Minimal shape check for a parsed prior snapshot — enough to guard the one
 * thing every consumer relies on (`surfaced` is an array to iterate). A
 * schema-drifted or hand-corrupted file that parses as JSON but isn't
 * actually a SitrepModel must not be blindly cast and carried forward.
 */
function isSitrepModelShape(x: unknown): x is SitrepModel {
  return (
    typeof x === "object" &&
    x !== null &&
    Array.isArray((x as { surfaced?: unknown }).surfaced)
  );
}

/** UTC date of `now` — at the 08:30 SGT schedule (00:30 UTC) both agree. */
function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function snapshotPath(dir: string, now: Date): string {
  return join(dir, `${utcDate(now)}.json`);
}

/**
 * The most recent snapshot dated strictly BEFORE today's UTC date, or null.
 * Strictly-before keeps intraday re-runs comparing against yesterday, so
 * "since yesterday" notes stay stable within a day.
 */
export function readPriorSnapshot(dir: string, now: Date): SitrepModel | null {
  const today = utcDate(now);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null; // no data directory yet — first ever run
  }

  const prior = names
    .map((n) => SNAPSHOT_RE.exec(n)?.[1])
    .filter((d): d is string => d !== undefined && d < today)
    .sort()
    .at(-1);
  if (!prior) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(dir, `${prior}.json`), "utf8"));
  } catch (err) {
    console.error(`prior snapshot ${prior}.json unreadable — continuing without change notes: ${String(err)}`);
    return null;
  }

  if (!isSitrepModelShape(parsed)) {
    console.error(`prior snapshot ${prior}.json has unexpected shape — continuing without change notes`);
    return null;
  }
  return parsed;
}

/** Write (or overwrite — latest state wins, ADR 0009) today's snapshot. */
export function writeSnapshot(dir: string, now: Date, model: SitrepModel): void {
  mkdirSync(dir, { recursive: true });
  const finalPath = snapshotPath(dir, now);
  // Write to a temp file in the same directory, then rename into place — the
  // rename is atomic on the same filesystem, so a killed/timed-out process
  // mid-write can never commit a truncated JSON file into the git audit trail
  // (ADR 0006) at the final path.
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(model, null, 2) + "\n", "utf8");
  renameSync(tmpPath, finalPath);
}
