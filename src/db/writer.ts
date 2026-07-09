import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eventVersions, ingestRuns, type EventVersionRow, type IngestRunRow } from "./schema.js";
import type * as schema from "./schema.js";

type Db = PostgresJsDatabase<typeof schema>;

/** Append rows, deduping on the source-version unique key. Returns rows inserted. */
export async function insertEventVersions(db: Db, rows: EventVersionRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db.insert(eventVersions).values(rows)
    .onConflictDoNothing({ target: [eventVersions.feed, eventVersions.feedEventId, eventVersions.sourceUpdatedAt] })
    .returning({ id: eventVersions.id });
  return inserted.length;
}

export async function recordIngestRun(db: Db, run: IngestRunRow): Promise<void> {
  await db.insert(ingestRuns).values(run)
    .onConflictDoUpdate({ target: ingestRuns.runAt, set: run });
}
