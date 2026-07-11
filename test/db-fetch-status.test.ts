import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resetDb, closeDb } from "./helpers/db.js";
import { recordIngestRun } from "../src/db/writer.js";
import { lastFetchByFeed } from "../src/db/reader.js";

const run = (
  runAt: Date,
  feedsOk: string[],
  feedsDown: { feed: string; reason: string }[] = [],
) => ({ runAt, feedsOk, feedsDown, surfacedCount: 0, dbWriteOk: true });

describe.skipIf(!process.env.DATABASE_URL)("lastFetchByFeed", () => {
  beforeAll(async () => { await resetDb(); });
  afterEach(async () => { await resetDb(); });
  afterAll(async () => { await closeDb(); });

  it("no runs -> nulls and empties", async () => {
    const db = await resetDb();
    expect(await lastFetchByFeed(db)).toEqual({
      latestRunAt: null, latestFeedsOk: [], lastOkByFeed: {},
    });
  });

  it("last OK per feed = max run_at in feeds_ok; latest run drives latestRunAt/latestFeedsOk", async () => {
    const db = await resetDb();
    const t1 = Date.UTC(2026, 6, 10, 6, 0);
    const t2 = Date.UTC(2026, 6, 11, 6, 0);
    await recordIngestRun(db, run(new Date(t1), ["USGS", "GDACS", "ReliefWeb"]));
    await recordIngestRun(db, run(new Date(t2), ["USGS", "GDACS"], [{ feed: "ReliefWeb", reason: "timeout" }]));
    const s = await lastFetchByFeed(db);
    expect(s.latestRunAt).toBe(t2);
    expect([...s.latestFeedsOk].sort()).toEqual(["GDACS", "USGS"]);
    expect(s.lastOkByFeed).toEqual({ USGS: t2, GDACS: t2, ReliefWeb: t1 });
  });

  it("a feed that never succeeded is absent from lastOkByFeed", async () => {
    const db = await resetDb();
    const t = Date.UTC(2026, 6, 11, 6, 0);
    await recordIngestRun(db, run(new Date(t), ["USGS"],
      [{ feed: "GDACS", reason: "500" }, { feed: "ReliefWeb", reason: "500" }]));
    const s = await lastFetchByFeed(db);
    expect(s.lastOkByFeed).toEqual({ USGS: t });
    expect(s.latestFeedsOk).toEqual(["USGS"]);
  });
});
