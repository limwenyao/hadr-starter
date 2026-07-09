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
});
