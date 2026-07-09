import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";
import type { SitrepModel, FeedResult } from "../types.js";
import type { FeatureCollection } from "geojson";
import { insertEventVersions, recordIngestRun } from "./writer.js";
import { surfacedEventToRow } from "./mapping.js";
import { footprintKey } from "../footprints/fill.js";

type Db = PostgresJsDatabase<typeof schema>;

export async function persistRun(
  db: Db, assessed: SitrepModel, feedResults: FeedResult[], now: Date,
  geometryById: Record<string, FeatureCollection>,
): Promise<{ inserted: number; dbWriteOk: boolean }> {
  // Run metadata is shared by the success and failure records so a failed run
  // is still auditable (which feeds were up, how many events it tried to write).
  const runBase = {
    runAt: now,
    feedsOk: feedResults.filter((f) => f.status === "ok").map((f) => f.feed),
    feedsDown: feedResults.filter((f) => f.status === "unavailable")
      .map((f) => ({ feed: f.feed, reason: (f as { error: string }).error })),
    surfacedCount: assessed.surfaced.length,
  };
  try {
    const rows = assessed.surfaced.map((e) => ({
      ...surfacedEventToRow(e, now),
      footprintGeometry: geometryById[footprintKey(e)] ?? null,
    }));
    const inserted = await insertEventVersions(db, rows);
    await recordIngestRun(db, { ...runBase, dbWriteOk: true });
    return { inserted, dbWriteOk: true };
  } catch (err) {
    // Best-effort failure audit: record db_write_ok=false so the run is visible
    // in ingest_runs (never fail silently — CLAUDE.md #4). If the DB is fully
    // unreachable this write also fails; swallow that and rethrow the original
    // error so the caller still flags the run (run.ts sets a non-zero exit).
    try {
      await recordIngestRun(db, { ...runBase, dbWriteOk: false });
    } catch {
      // DB unreachable — nothing more we can persist.
    }
    throw err;
  }
}
