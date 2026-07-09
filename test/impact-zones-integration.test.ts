import { describe, it, expect } from "vitest";
import { fillFootprints } from "../src/footprints/fill.js";
import { renderDashboard } from "../src/render/dashboard.js";
import type { SitrepModel, SurfacedEvent } from "../src/types.js";

function ev(over: Partial<SurfacedEvent>): SurfacedEvent {
  return { feed: "USGS", feedEventId: "q1", hazardType: "EQ", title: "M6", locationName: "x",
    coordinates: { lon: 10, lat: 20, depthKm: 5 }, time: 0, metrics: { mag: 6 }, tier: "HIGH", ...over };
}
const m: SitrepModel = { generatedAt: 0, surfaced: [ev({})], degradation: [], withdrawn: [], changeSummary: null };

describe("impact-zones integration", () => {
  it("flows fillFootprints geometry into the rendered page", async () => {
    const source = {
      forEvent: async () => ({
        summary: { provenance: "estimated" as const, label: "Estimated felt radius", isEstimate: true, radiusKm: 100 },
        geometry: { type: "FeatureCollection" as const, features: [
          { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [10, 20] },
            properties: { provenance: "estimated", isEstimate: true, color: "#7d95b5" } }] },
      }),
    };
    const { model, geometryById } = await fillFootprints(m, source);
    expect(model.surfaced[0].footprint!.isEstimate).toBe(true);
    const html = renderDashboard(model, geometryById);
    expect(html).toContain('"eventId":"USGS q1"');
  });
});
