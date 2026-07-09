import { describe, it, expect } from "vitest";
import { fillFootprints, footprintKey } from "../src/footprints/fill.js";
import type { SitrepModel, SurfacedEvent, FootprintResult } from "../src/types.js";

function ev(over: Partial<SurfacedEvent>): SurfacedEvent {
  return {
    feed: "USGS", feedEventId: "id1", hazardType: "EQ", title: "t", locationName: "l",
    coordinates: { lon: 1, lat: 2 }, time: 0, metrics: { mag: 6 }, tier: "HIGH", ...over,
  };
}
function model(surfaced: SurfacedEvent[]): SitrepModel {
  return { generatedAt: 0, surfaced, degradation: [], withdrawn: [], changeSummary: null };
}
const fakeResult: FootprintResult = {
  summary: { provenance: "estimated", label: "Estimated felt radius", isEstimate: true, radiusKm: 100 },
  geometry: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: { provenance: "estimated", isEstimate: true, color: "#7d95b5" } }] },
};

describe("fillFootprints", () => {
  it("attaches the summary to each event and keys geometry by composite id", async () => {
    const src = { forEvent: async () => fakeResult };
    const { model: out, geometryById } = await fillFootprints(model([ev({})]), src);
    expect(out.surfaced[0].footprint!.label).toBe("Estimated felt radius");
    expect(geometryById["USGS id1"]).toBeDefined();
  });
  it("stamps the footprint key as eventId on every embedded feature", async () => {
    const src = { forEvent: async () => fakeResult };
    const { geometryById } = await fillFootprints(model([ev({})]), src);
    expect(geometryById["USGS id1"].features[0].properties!.eventId).toBe("USGS id1");
  });
  it("degrades to no footprint (no throw) when the source throws", async () => {
    const src = { forEvent: async () => { throw new Error("boom"); } };
    const { model: out, geometryById } = await fillFootprints(model([ev({})]), src);
    expect(out.surfaced[0].footprint).toBeUndefined();
    expect(Object.keys(geometryById)).toHaveLength(0);
  });
  it("leaves events without a result untouched", async () => {
    const src = { forEvent: async () => undefined };
    const { model: out } = await fillFootprints(model([ev({})]), src);
    expect(out.surfaced[0].footprint).toBeUndefined();
  });
  it("returns a fresh model when there are no surfaced events", async () => {
    const m = model([]);
    const { model: out } = await fillFootprints(m, { forEvent: async () => fakeResult });
    expect(out).not.toBe(m);
    expect(out.surfaced).toHaveLength(0);
  });
  it("footprintKey uses a space separator", () => {
    expect(footprintKey({ feed: "GDACS", feedEventId: "9" })).toBe("GDACS 9");
  });
});
