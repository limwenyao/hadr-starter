import { describe, it, expect } from "vitest";
import { simplifyGeometry, eachPosition } from "../src/footprints/simplify.js";

describe("simplifyGeometry (RDP)", () => {
  it("drops collinear interior points on a LineString", () => {
    const line = { type: "LineString", coordinates: [[0, 0], [1, 0.0001], [2, 0], [3, 5]] };
    const out = simplifyGeometry(line as any, 0.01) as any;
    // The near-collinear middle points collapse; endpoints stay.
    expect(out.coordinates[0]).toEqual([0, 0]);
    expect(out.coordinates[out.coordinates.length - 1]).toEqual([3, 5]);
    expect(out.coordinates.length).toBeLessThan(4);
  });
  it("simplifies each ring of a Polygon and keeps it closed-shaped", () => {
    const poly = { type: "Polygon", coordinates: [[[0, 0], [1, 0.0001], [2, 0], [2, 2], [0, 2], [0, 0]]] };
    const out = simplifyGeometry(poly as any, 0.01) as any;
    expect(out.type).toBe("Polygon");
    expect(out.coordinates[0].length).toBeLessThan(6);
  });
  it("handles MultiLineString without throwing", () => {
    const mls = { type: "MultiLineString", coordinates: [[[0, 0], [1, 0], [2, 0]]] };
    const out = simplifyGeometry(mls as any, 0.01) as any;
    expect(out.type).toBe("MultiLineString");
  });
});

describe("eachPosition", () => {
  it("visits every coordinate of a Polygon", () => {
    const poly = { type: "Polygon", coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]] };
    const seen: number[][] = [];
    eachPosition(poly as any, (p) => seen.push(p));
    expect(seen).toHaveLength(4);
  });
});
