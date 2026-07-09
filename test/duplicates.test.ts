import { describe, it, expect } from "vitest";
import { flagDuplicates } from "../src/core/duplicates.js";
import type { SurfacedEvent, Tier, FeedName } from "../src/types.js";

const TOKYO = { lon: 139.69, lat: 35.69 };

function ev(over: Partial<SurfacedEvent> & { feedEventId: string }): SurfacedEvent {
  return {
    feed: "USGS" as FeedName,
    hazardType: "EQ",
    title: `Event ${over.feedEventId}`,
    locationName: "somewhere",
    coordinates: { ...TOKYO },
    time: Date.UTC(2026, 6, 6, 12, 0, 0),
    metrics: {},
    tier: "HIGH" as Tier,
    ...over,
  };
}

describe("flagDuplicates (ADR 0007 — flag, never merge)", () => {
  it("flags a lower-priority cross-feed match as duplicateOf the primary", () => {
    // Same quake: USGS first (sorted primary), GDACS second, same place & time.
    const surfaced = [
      ev({ feedEventId: "usgs-1", feed: "USGS", title: "USGS quake" }),
      ev({ feedEventId: "gdacs-1", feed: "GDACS", title: "GDACS quake" }),
    ];
    const out = flagDuplicates(surfaced);
    expect(out).toHaveLength(2); // both retained — never dropped
    expect(out[0].duplicateOf).toBeUndefined();
    expect(out[1].duplicateOf).toEqual({
      feed: "USGS",
      feedEventId: "usgs-1",
      title: "USGS quake",
    });
  });

  it("does NOT flag two events from the same feed (cross-feed only)", () => {
    const surfaced = [
      ev({ feedEventId: "usgs-1", feed: "USGS" }),
      ev({ feedEventId: "usgs-2", feed: "USGS" }),
    ];
    const out = flagDuplicates(surfaced);
    expect(out.every((e) => e.duplicateOf === undefined)).toBe(true);
  });

  it("does NOT flag different hazard types even if co-located and simultaneous", () => {
    const surfaced = [
      ev({ feedEventId: "usgs-1", feed: "USGS", hazardType: "EQ" }),
      ev({ feedEventId: "gdacs-1", feed: "GDACS", hazardType: "TC" }),
    ];
    expect(flagDuplicates(surfaced).every((e) => !e.duplicateOf)).toBe(true);
  });

  it("does NOT flag matches outside the time window", () => {
    const surfaced = [
      ev({ feedEventId: "usgs-1", feed: "USGS" }),
      ev({
        feedEventId: "gdacs-1",
        feed: "GDACS",
        time: Date.UTC(2026, 6, 6, 15, 0, 0), // +3h > 90 min
      }),
    ];
    expect(flagDuplicates(surfaced).every((e) => !e.duplicateOf)).toBe(true);
  });

  it("does NOT flag matches outside the distance window", () => {
    const surfaced = [
      ev({ feedEventId: "usgs-1", feed: "USGS" }),
      ev({
        feedEventId: "gdacs-1",
        feed: "GDACS",
        coordinates: { lon: 139.69, lat: 40.69 }, // ~555 km north
      }),
    ];
    expect(flagDuplicates(surfaced).every((e) => !e.duplicateOf)).toBe(true);
  });

  it("never flags events missing coordinates (no spatial match possible)", () => {
    const surfaced = [
      ev({ feedEventId: "usgs-1", feed: "USGS", coordinates: undefined }),
      ev({ feedEventId: "gdacs-1", feed: "GDACS", coordinates: undefined }),
    ];
    expect(flagDuplicates(surfaced).every((e) => !e.duplicateOf)).toBe(true);
  });

  it("does not attribute a later event to an intermediate duplicate (dead-guard regression)", () => {
    // A (USGS, primary, most severe) — B (GDACS, dup of A, same place/time) —
    // C (USGS, same place/time as A and B). C can never match A directly (same
    // feed — cross-feed only), so its only geometric candidate is B. But B is
    // itself already flagged as a duplicate of A: with the guard dead (reading
    // the never-mutated input array instead of the accumulated result), C would
    // wrongly be attributed to B, an intermediate duplicate rather than the
    // cluster head. Fixed, C must not chain onto B.
    const A = ev({ feedEventId: "a", feed: "USGS", tier: "CRITICAL", metrics: { mag: 7.0 } });
    const B = ev({ feedEventId: "b", feed: "GDACS", tier: "HIGH", metrics: { mag: 6.0 } });
    const C = ev({ feedEventId: "c", feed: "USGS", tier: "MODERATE", metrics: { mag: 5.0 } });
    const surfaced = [A, B, C];
    const out = flagDuplicates(surfaced);
    const b = out.find((e) => e.feedEventId === "b")!;
    const c = out.find((e) => e.feedEventId === "c")!;
    expect(b.duplicateOf).toEqual({ feed: "USGS", feedEventId: "a", title: A.title });
    // C matches B geometrically, but B is itself a duplicate — no chains: C's
    // duplicateOf must not point at B (an event that itself has duplicateOf set).
    expect(c.duplicateOf?.feedEventId).not.toBe("b");
  });

  it("never produces a chain-of-chains: no duplicateOf points at an already-flagged duplicate", () => {
    const surfaced = [
      ev({ feedEventId: "usgs-1", feed: "USGS" }),
      ev({ feedEventId: "gdacs-1", feed: "GDACS" }),
      ev({ feedEventId: "usgs-2", feed: "USGS" }),
    ];
    const out = flagDuplicates(surfaced);
    const byKey = new Map(out.map((e) => [`${e.feed} ${e.feedEventId}`, e]));
    for (const e of out) {
      if (!e.duplicateOf) continue;
      const primary = byKey.get(`${e.duplicateOf.feed} ${e.duplicateOf.feedEventId}`);
      expect(primary?.duplicateOf).toBeUndefined();
    }
  });

  it("does not mutate the input events", () => {
    const surfaced = [
      ev({ feedEventId: "usgs-1", feed: "USGS" }),
      ev({ feedEventId: "gdacs-1", feed: "GDACS" }),
    ];
    flagDuplicates(surfaced);
    expect(surfaced[1].duplicateOf).toBeUndefined();
  });
});
