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
    // Ring stays closed: first position equals last.
    const ring = out.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
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
  it("visits every coordinate of a GeometryCollection's members", () => {
    const gc = {
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [0, 0] },
        { type: "LineString", coordinates: [[1, 1], [2, 2], [3, 3]] },
      ],
    };
    const seen: number[][] = [];
    eachPosition(gc as any, (p) => seen.push(p));
    // 1 from the Point + 3 from the LineString = 4 positions.
    expect(seen).toHaveLength(4);
  });
});
