import { describe, it, expect } from "vitest";
import { summariseGdacsGeometry } from "../src/footprints/gdacs.js";

const GEOM = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { Class: "Point_Centroid", alertlevel: "Red" },
      geometry: { type: "Point", coordinates: [130, 18] } },
    { type: "Feature", properties: { alertlevel: "Red", polygonlabel: "wind" },
      geometry: { type: "Polygon", coordinates: [[[129, 17], [131, 17], [131, 19], [129, 19], [129, 17]]] } },
    { type: "Feature", properties: { alertlevel: "Orange" },
      geometry: { type: "LineString", coordinates: [[130, 18], [132, 20], [134, 22]] } },
  ],
};

describe("summariseGdacsGeometry", () => {
  it("keeps polygons/lines, drops the centroid point, tags provenance gdacs", () => {
    const r = summariseGdacsGeometry(GEOM, "TC")!;
    expect(r.summary.provenance).toBe("gdacs");
    expect(r.summary.isEstimate).toBe(false);
    expect(r.summary.label).toContain("tropical cyclone");
    expect(r.geometry!.features).toHaveLength(2);            // point dropped
    expect(r.geometry!.features.every((f) => f.properties!.provenance === "gdacs")).toBe(true);
  });
  it("colours features by alert level", () => {
    const feats = summariseGdacsGeometry(GEOM, "TC")!.geometry!.features;
    expect(feats.find((f) => f.geometry.type === "Polygon")!.properties!.color).toBe("#ef4444"); // Red
    expect(feats.find((f) => f.geometry.type === "LineString")!.properties!.color).toBe("#f59e0b"); // Orange
  });
  it("computes a rough radiusKm from the bbox", () => {
    expect(summariseGdacsGeometry(GEOM, "TC")!.summary.radiusKm).toBeGreaterThan(0);
  });
  it("returns undefined for malformed / polygonless input (never throws)", () => {
    expect(summariseGdacsGeometry(null, "TC")).toBeUndefined();
    expect(summariseGdacsGeometry({ features: [{ geometry: { type: "Point", coordinates: [0, 0] } }] }, "EQ")).toBeUndefined();
  });
  it("labels unknown hazard codes with the raw code", () => {
    expect(summariseGdacsGeometry(GEOM, "ZZ")!.summary.label).toContain("ZZ");
  });
});
