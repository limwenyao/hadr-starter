import { describe, it, expect } from "vitest";
import { summariseShakeMap } from "../src/footprints/shakemap.js";

const CONT_MMI = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { value: 2, units: "mmi", color: "#83ffff", weight: 2 },
      geometry: { type: "MultiLineString", coordinates: [[[-123.9, 49.1], [-123.8, 49.15], [-123.7, 49.2]]] } },
    { type: "Feature", properties: { value: 3.5, units: "mmi", color: "#7aff93", weight: 2 },
      geometry: { type: "MultiLineString", coordinates: [[[-123.5, 49.0], [-123.4, 49.05]]] } },
  ],
};

describe("summariseShakeMap", () => {
  it("summarises MMI contours with provenance shakemap", () => {
    const r = summariseShakeMap(CONT_MMI)!;
    expect(r.summary.provenance).toBe("shakemap");
    expect(r.summary.isEstimate).toBe(false);
    expect(r.summary.maxMmi).toBe(3.5);
    expect(r.summary.label).toContain("ShakeMap");
  });
  it("normalises features: carries the USGS colour, provenance, not-estimate", () => {
    const f = summariseShakeMap(CONT_MMI)!.geometry!.features[0];
    expect(f.properties!.provenance).toBe("shakemap");
    expect(f.properties!.isEstimate).toBe(false);
    expect(f.properties!.color).toBe("#83ffff");
    expect(f.geometry.type).toBe("MultiLineString");
  });
  it("returns undefined for malformed / contour-less input (never throws)", () => {
    expect(summariseShakeMap(null)).toBeUndefined();
    expect(summariseShakeMap({ features: [] })).toBeUndefined();
    expect(summariseShakeMap({ features: [{ geometry: { type: "Point", coordinates: [0, 0] } }] })).toBeUndefined();
  });
});
