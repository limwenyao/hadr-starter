import { describe, it, expect } from "vitest";
import { estimateFeltRadiusKm, circlePolygon, estimateFootprint } from "../src/footprints/estimate.js";
import { EST_RING_POINTS } from "../src/thresholds.js";

describe("estimateFeltRadiusKm", () => {
  it("is undefined without a magnitude", () => {
    expect(estimateFeltRadiusKm(undefined, 10)).toBeUndefined();
  });
  it("gives physically sane shallow-quake felt radii", () => {
    expect(estimateFeltRadiusKm(5.0, 0)).toBeCloseTo(72, 0);   // ~70 km
    expect(estimateFeltRadiusKm(6.5, 0)).toBeCloseTo(316, 0);  // ~300 km
  });
  it("shrinks the surface radius for deep quakes", () => {
    const shallow = estimateFeltRadiusKm(6.5, 0)!;
    const deep = estimateFeltRadiusKm(6.5, 300)!;
    expect(deep).toBeLessThan(shallow);
    expect(deep).toBeCloseTo(100, 0); // sqrt(316^2 - 300^2)
  });
  it("returns undefined when the hypocentre is too deep to be felt at threshold", () => {
    expect(estimateFeltRadiusKm(5.0, 100)).toBeUndefined(); // R_hyp(~72) < depth
  });
});

describe("circlePolygon", () => {
  it("returns a closed ring of EST_RING_POINTS+1 positions", () => {
    const poly = circlePolygon(100, 0, 111, EST_RING_POINTS);
    expect(poly.type).toBe("Polygon");
    const ring = poly.coordinates[0];
    expect(ring).toHaveLength(EST_RING_POINTS + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    // ~1 degree of latitude north for 111 km.
    const north = Math.max(...ring.map((p) => p[1]));
    expect(north).toBeCloseTo(1, 1);
  });

  it("bounds the longitude excursion at the pole (cos(lat)→~0 clamp engages)", () => {
    // At lat 90, Math.cos ≈ 6.1e-17 (< the 1e-6 clamp floor), so the clamp
    // engages. Without it the longitude offset would be ~1e16°; with it the
    // offset is bounded to ~9e5°. Assert finiteness AND that the clamp bit —
    // a threshold the pre-fix code would blow past (making this a real
    // regression test, not one that passes either way).
    const poly = circlePolygon(0, 90, 100, EST_RING_POINTS);
    const ring = poly.coordinates[0];
    expect(ring.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))).toBe(true);
    const maxAbsLon = Math.max(...ring.map((p) => Math.abs(p[0])));
    expect(maxAbsLon).toBeLessThan(1e7);
  });
});

describe("estimateFootprint", () => {
  it("produces a dashed estimate FeatureCollection", () => {
    const r = estimateFootprint(100, 0, 6.5, 0)!;
    expect(r.summary.provenance).toBe("estimated");
    expect(r.summary.isEstimate).toBe(true);
    expect(r.summary.radiusKm).toBeGreaterThan(0);
    expect(r.geometry!.features[0].properties!.isEstimate).toBe(true);
    expect(r.geometry!.features[0].properties!.provenance).toBe("estimated");
  });
  it("is undefined when there is no drawable ring", () => {
    expect(estimateFootprint(100, 0, undefined, 0)).toBeUndefined();
    expect(estimateFootprint(100, 0, 5.0, 100)).toBeUndefined();
  });
});
