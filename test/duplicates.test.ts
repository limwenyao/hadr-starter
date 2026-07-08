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

  it("does not mutate the input events", () => {
    const surfaced = [
      ev({ feedEventId: "usgs-1", feed: "USGS" }),
      ev({ feedEventId: "gdacs-1", feed: "GDACS" }),
    ];
    flagDuplicates(surfaced);
    expect(surfaced[1].duplicateOf).toBeUndefined();
  });
});
