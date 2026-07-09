import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resetDb, closeDb } from "./helpers/db.js";
import { insertEventVersions } from "../src/db/writer.js";
import { latestSurfacedEvents, latestGeometryById } from "../src/db/reader.js";
import { surfacedEventToRow } from "../src/db/mapping.js";
import type { SurfacedEvent } from "../src/types.js";
import type { FeatureCollection } from "geojson";

const ev = (over: Partial<SurfacedEvent> = {}): SurfacedEvent => ({
  feed: "USGS", feedEventId: "us1", hazardType: "EQ", title: "t", locationName: "l",
  coordinates: { lon: 1, lat: 2 }, time: Date.UTC(2026, 6, 9, 0, 0),
  metrics: { mag: 6 }, tier: "HIGH",
  sourceUpdatedAt: Date.UTC(2026, 6, 9, 1, 0), updateProvenance: "source", ...over,
});

describe("db writer + reader", () => {
  beforeAll(async () => { await resetDb(); });
  afterEach(async () => { await resetDb(); });
  afterAll(async () => { await closeDb(); });

  it("inserts one row per distinct source version; dedups unchanged re-ingests", async () => {
    const db = await resetDb();
    const row = surfacedEventToRow(ev(), new Date());
    expect(await insertEventVersions(db, [row])).toBe(1);
    expect(await insertEventVersions(db, [row])).toBe(0); // same source version → dedup
  });

  it("adds a new row when sourceUpdatedAt advances", async () => {
    const db = await resetDb();
    await insertEventVersions(db, [surfacedEventToRow(ev(), new Date())]);
    const revised = ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 2, 0), metrics: { mag: 6.3 } });
    expect(await insertEventVersions(db, [surfacedEventToRow(revised, new Date())])).toBe(1);
  });

  it("latest-state returns the newest version per event", async () => {
    const db = await resetDb();
    await insertEventVersions(db, [surfacedEventToRow(ev({ metrics: { mag: 6 } }), new Date())]);
    await insertEventVersions(db, [surfacedEventToRow(
      ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 2, 0), metrics: { mag: 6.5 } }), new Date())]);
    const latest = await latestSurfacedEvents(db);
    expect(latest).toHaveLength(1);
    expect(latest[0].metrics.mag).toBe(6.5);
    expect(latest[0].sourceUpdatedAt).toBe(Date.UTC(2026, 6, 9, 2, 0));
  });

  it("late (earlier) source version does not become 'latest'", async () => {
    const db = await resetDb();
    await insertEventVersions(db, [surfacedEventToRow(
      ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 2, 0), metrics: { mag: 6.5 } }), new Date())]);
    await insertEventVersions(db, [surfacedEventToRow(
      ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 1, 0), metrics: { mag: 6.0 } }), new Date())]);
    const latest = await latestSurfacedEvents(db);
    expect(latest[0].metrics.mag).toBe(6.5);
  });
});

const fc = (lon: number): FeatureCollection => ({
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, 2] },
    properties: { eventId: "USGS us1" },
  }],
});

describe("latestGeometryById", () => {
  beforeAll(async () => { await resetDb(); });
  afterEach(async () => { await resetDb(); });
  afterAll(async () => { await closeDb(); });

  it("returns geometry keyed by feed+id, newest version wins, null excluded", async () => {
    const db = await resetDb();
    await insertEventVersions(db, [{ ...surfacedEventToRow(ev(), new Date()), footprintGeometry: fc(1) }]);
    await insertEventVersions(db, [{
      ...surfacedEventToRow(ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 2, 0) }), new Date()),
      footprintGeometry: fc(9),
    }]);
    await insertEventVersions(db, [surfacedEventToRow(ev({ feedEventId: "us2" }), new Date())]);

    const g = await latestGeometryById(db);
    expect(Object.keys(g)).toEqual(["USGS us1"]);           // us2 (null geometry) excluded
    expect(g["USGS us1"].features[0].geometry).toEqual({ type: "Point", coordinates: [9, 2] }); // newest wins
  });
});
