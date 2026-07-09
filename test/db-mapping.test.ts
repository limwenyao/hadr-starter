import { describe, it, expect } from "vitest";
import { surfacedEventToRow, rowToSurfacedEvent } from "../src/db/mapping.js";
import type { SurfacedEvent } from "../src/types.js";

const base: SurfacedEvent = {
  feed: "USGS", feedEventId: "us1", hazardType: "EQ",
  title: "M 6.0 - somewhere", locationName: "somewhere",
  coordinates: { lon: 10, lat: -5, depthKm: 12 },
  time: Date.UTC(2026, 6, 9, 3, 0), metrics: { mag: 6.0, pagerAlert: "orange" },
  tier: "CRITICAL", assessment: "Prose.", sourceUrl: "https://usgs.gov/x",
  sourceUpdatedAt: Date.UTC(2026, 6, 9, 4, 0), updateProvenance: "source",
};

describe("surfacedEventToRow", () => {
  it("maps identity, both clocks, and splits coordinates into lon/lat", () => {
    const row = surfacedEventToRow(base, new Date(Date.UTC(2026, 6, 9, 5, 0)));
    expect(row).toMatchObject({
      feed: "USGS", feedEventId: "us1", tier: "CRITICAL", hazardType: "EQ",
      title: "M 6.0 - somewhere", locationName: "somewhere",
      lon: 10, lat: -5, assessment: "Prose.", sourceUrl: "https://usgs.gov/x",
      updateProvenance: "source",
    });
    expect(row.eventTime).toEqual(new Date(Date.UTC(2026, 6, 9, 3, 0)));
    expect(row.sourceUpdatedAt).toEqual(new Date(Date.UTC(2026, 6, 9, 4, 0)));
    expect(row.ingestedAt).toEqual(new Date(Date.UTC(2026, 6, 9, 5, 0)));
    expect(row.metrics).toEqual({ mag: 6.0, pagerAlert: "orange" });
  });

  it("uses event time + 'inferred' when sourceUpdatedAt is absent", () => {
    const { sourceUpdatedAt, updateProvenance, ...rest } = base;
    const row = surfacedEventToRow(rest as SurfacedEvent, new Date(0));
    expect(row.sourceUpdatedAt).toEqual(new Date(Date.UTC(2026, 6, 9, 3, 0)));
    expect(row.updateProvenance).toBe("inferred");
  });

  it("null lon/lat for events without coordinates (ReliefWeb list-only)", () => {
    const { coordinates, ...rest } = base;
    const row = surfacedEventToRow(rest as SurfacedEvent, new Date(0));
    expect(row.lon).toBeNull();
    expect(row.lat).toBeNull();
  });

  it("round-trips through rowToSurfacedEvent", () => {
    const row = surfacedEventToRow(base, new Date(Date.UTC(2026, 6, 9, 5, 0)));
    const back = rowToSurfacedEvent({ ...row, id: 1 });
    expect(back.feedEventId).toBe("us1");
    expect(back.coordinates).toEqual({ lon: 10, lat: -5 });
    expect(back.time).toBe(Date.UTC(2026, 6, 9, 3, 0));
    expect(back.sourceUpdatedAt).toBe(Date.UTC(2026, 6, 9, 4, 0));
    expect(back.tier).toBe("CRITICAL");
  });
});
