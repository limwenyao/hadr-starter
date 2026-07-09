import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resetDb, closeDb } from "./helpers/db.js";
import { sql } from "drizzle-orm";
import { persistRun } from "../src/db/persist.js";
import type { SitrepModel, FeedResult } from "../src/types.js";

const model = (surfaced: SitrepModel["surfaced"]): SitrepModel => ({
  generatedAt: Date.UTC(2026, 6, 9, 8, 0), surfaced, degradation: [], withdrawn: [], changeSummary: null,
});
const okFeeds: FeedResult[] = [{ feed: "USGS", status: "ok", rawPayload: {} }];

describe("persistRun", () => {
  beforeAll(async () => { await resetDb(); });
  afterEach(async () => { await resetDb(); });
  afterAll(async () => { await closeDb(); });

  it("writes surfaced events and records an ingest_run with db_write_ok=true", async () => {
    const db = await resetDb();
    const res = await persistRun(db, model([{
      feed: "USGS", feedEventId: "us1", hazardType: "EQ", title: "t", locationName: "l",
      coordinates: { lon: 1, lat: 2 }, time: Date.UTC(2026, 6, 9, 7, 0), metrics: { mag: 6 },
      tier: "HIGH", sourceUpdatedAt: Date.UTC(2026, 6, 9, 7, 30), updateProvenance: "source",
    }]), okFeeds, new Date(Date.UTC(2026, 6, 9, 8, 0)));
    expect(res).toEqual({ inserted: 1, dbWriteOk: true });
    const runs = await db.execute(sql`SELECT surfaced_count, db_write_ok FROM ingest_runs`);
    expect((runs as unknown as any[])[0].surfaced_count).toBe(1);
  });

  it("records an ingest_run with db_write_ok=false when the event write fails", async () => {
    const db = await resetDb();
    // An invalid tier violates the event_versions CHECK constraint, so the
    // event insert throws. persistRun must still leave an auditable failure row.
    const bad = model([{
      feed: "USGS", feedEventId: "us-bad", hazardType: "EQ", title: "t", locationName: "l",
      coordinates: { lon: 1, lat: 2 }, time: Date.UTC(2026, 6, 9, 7, 0), metrics: { mag: 6 },
      tier: "BOGUS" as SitrepModel["surfaced"][number]["tier"],
      sourceUpdatedAt: Date.UTC(2026, 6, 9, 7, 30), updateProvenance: "source",
    }]);
    await expect(persistRun(db, bad, okFeeds, new Date(Date.UTC(2026, 6, 9, 8, 0)))).rejects.toThrow();
    const events = await db.execute(sql`SELECT count(*)::int AS n FROM event_versions`);
    expect((events as unknown as any[])[0].n).toBe(0); // nothing persisted
    const runs = await db.execute(sql`SELECT surfaced_count, db_write_ok FROM ingest_runs`);
    expect((runs as unknown as any[])[0].db_write_ok).toBe(false);
    expect((runs as unknown as any[])[0].surfaced_count).toBe(1);
  });
});
