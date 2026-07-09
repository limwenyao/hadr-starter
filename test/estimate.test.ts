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

  it("emits only finite coordinates at a near-polar latitude (cos(lat)→0 guard)", () => {
    const poly = circlePolygon(0, 89.999, 100, EST_RING_POINTS);
    const allFinite = poly.coordinates[0].every(
      (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]),
    );
    expect(allFinite).toBe(true);
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
