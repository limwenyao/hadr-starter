import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

  try {
    return JSON.parse(readFileSync(join(dir, `${prior}.json`), "utf8")) as SitrepModel;
  } catch (err) {
    console.error(`prior snapshot ${prior}.json unreadable — continuing without change notes: ${String(err)}`);
    return null;
  }
}

/** Write (or overwrite — latest state wins, ADR 0009) today's snapshot. */
export function writeSnapshot(dir: string, now: Date, model: SitrepModel): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(snapshotPath(dir, now), JSON.stringify(model, null, 2) + "\n", "utf8");
}
