import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";
import type { SitrepModel, FeedResult } from "../types.js";
import { insertEventVersions, recordIngestRun } from "./writer.js";
import { surfacedEventToRow } from "./mapping.js";

type Db = PostgresJsDatabase<typeof schema>;

export async function persistRun(
  db: Db, assessed: SitrepModel, feedResults: FeedResult[], now: Date,
): Promise<{ inserted: number; dbWriteOk: boolean }> {
  const rows = assessed.surfaced.map((e) => surfacedEventToRow(e, now));
  const inserted = await insertEventVersions(db, rows);
  await recordIngestRun(db, {
    runAt: now,
    feedsOk: feedResults.filter((f) => f.status === "ok").map((f) => f.feed),
    feedsDown: feedResults.filter((f) => f.status === "unavailable")
      .map((f) => ({ feed: f.feed, reason: (f as { error: string }).error })),
    surfacedCount: assessed.surfaced.length,
    dbWriteOk: true,
  });
  return { inserted, dbWriteOk: true };
}
