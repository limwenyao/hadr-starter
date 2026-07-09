import { describe, it, expect } from "vitest";
import {
  FELT_MMI_THRESHOLD, IPE_C0, IPE_C1, IPE_C2,
  EST_MAX_RADIUS_KM, EST_RING_POINTS,
  GEOMETRY_SIMPLIFY_TOLERANCE_DEG, FOOTPRINT_FETCH_TIMEOUT_MS,
} from "../src/thresholds.js";

describe("impact-zone thresholds", () => {
  it("exposes sane footprint constants", () => {
    expect(FELT_MMI_THRESHOLD).toBe(3.5);
    expect(IPE_C2).toBeLessThan(0);          // intensity decays with distance
    expect(IPE_C1).toBeGreaterThan(0);       // and grows with magnitude
    expect(EST_MAX_RADIUS_KM).toBeGreaterThan(0);
    expect(EST_RING_POINTS).toBeGreaterThanOrEqual(24);
    expect(GEOMETRY_SIMPLIFY_TOLERANCE_DEG).toBeGreaterThan(0);
    expect(FOOTPRINT_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    expect([IPE_C0, IPE_C1, IPE_C2].every(Number.isFinite)).toBe(true);
  });
});
