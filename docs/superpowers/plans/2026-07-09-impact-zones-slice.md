# Impact Zones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For each surfaced, coordinate-bearing event, embed a confidence-tiered impact-area overlay (modeled ShakeMap contours / modeled GDACS polygons / estimated felt-radius ring), shown on the map only when its event is selected or a panel toggle reveals all.

**Architecture:** The pure core (`buildSitrep`) is untouched. A new impure enrichment step `fillFootprints(model, source)` runs in `run.ts` after the core selects surfaced events — mirroring `fillAssessments`. It fetches footprint geometry through an **injected `FootprintSource`** (network behind a seam; tests use a fake), attaches a compact `FootprintSummary` to each event (→ snapshot + panel text), and returns a side map of **normalized** GeoJSON keyed by `` `${feed} ${feedEventId}` `` that the renderer embeds in a second `<script>` block. The client draws one reusable GeoJSON source with data-driven paint and a single `setFilter` governed by `(mode, activeKey)`.

**Tech Stack:** TypeScript/Node 20 ESM, tsx, Vitest, MapLibre GL (client), `geojson` types (dev-only, new).

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-07-09-impact-zones-design.md` and CLAUDE.md — every task's requirements implicitly include these:

- **Never overstate.** Impact areas are modeled/estimated extents, **never** an evacuation boundary. The permanent caption `Modeled or estimated extents — not official evacuation boundaries.` must be present in the rendered page, and estimate zones must be visually distinct (dashed) and labeled `estimate`.
- **Pure core seam is sacred.** `buildSitrep` makes no network call. All footprint I/O lives in `run.ts`-level enrichment behind an injected `FootprintSource`. Tests never hit the network or run a browser.
- **Never fail silently / never crash (CLAUDE.md #4).** Any footprint fetch/parse failure resolves to "no zone" (EQ falls back to the estimate ring); the run continues. No unhandled throw. No per-event degradation spam.
- **Thresholds are named constants (CLAUDE.md #3).** All tunables live in `src/thresholds.ts`.
- **Domain vocabulary (CLAUDE.md #6).** Use "assessment" only for LLM prose; footprints are a separate concern and never called an assessment.
- **Feed text is untrusted.** Any footprint-derived text rendered in the DOM goes through `textContent` only; the embedded geometry JSON has every `<` escaped to `<` exactly as the existing payload does.
- **Default hide-all.** The app starts with no zone drawn; a zone appears only on event selection, or when the toggle is flipped to show-all.
- **The estimate ring uses a documented depth-aware IPE with calibrated constants** (see Task 3) — deliberately NOT claiming the exact Allen-Wald-Worden 2012 coefficient table (unverifiable here). This is a recorded Deviation (Task 11).

**Composite key:** everywhere a footprint is keyed to an event, the key is the string `` `${event.feed} ${event.feedEventId}` `` (space separator — same convention as `src/core/changes.ts`). Call this the event's **footprint key**.

**Normalized footprint feature:** every embedded geometry Feature has exactly these `properties` (nothing from the raw feed payload survives — this both slims the payload and keeps the client dumb):
```ts
{ eventId: string;        // the footprint key (stamped by fillFootprints)
  provenance: "shakemap" | "gdacs" | "estimated";
  isEstimate: boolean;
  color: string;          // "#rrggbb" — drives client line/fill paint
}
```

---

### Task 1: Foundations — types, constants, `geojson` dep

**Files:**
- Modify: `src/types.ts`
- Modify: `src/thresholds.ts`
- Modify: `package.json` (devDependency `@types/geojson`)
- Test: `test/thresholds-footprints.test.ts` (create)

**Interfaces:**
- Produces: `FootprintProvenance`, `FootprintSummary`, `FootprintResult`, `Event.footprintRef?`, `SurfacedEvent.footprint?`; constants `FELT_MMI_THRESHOLD`, `IPE_C0`, `IPE_C1`, `IPE_C2`, `EST_MAX_RADIUS_KM`, `EST_RING_POINTS`, `GEOMETRY_SIMPLIFY_TOLERANCE_DEG`, `FOOTPRINT_FETCH_TIMEOUT_MS`.

- [ ] **Step 1: Add the dev dependency**

Run: `npm install --save-dev @types/geojson`
Expected: `@types/geojson` appears under `devDependencies`; lockfile updated. (Common, well-maintained DefinitelyTyped package — approved per the repo's dependency policy; it ships types only, no runtime code.)

- [ ] **Step 2: Write the failing test for the new constants**

Create `test/thresholds-footprints.test.ts`:
```ts
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run test/thresholds-footprints.test.ts`
Expected: FAIL — the constants do not exist yet.

- [ ] **Step 4: Add the constants to `src/thresholds.ts`**

Append to `src/thresholds.ts`:
```ts
/**
 * ── Impact zones (impact-zones slice) ────────────────────────────────────
 * Estimated felt-radius model. A documented depth-aware intensity prediction
 * equation of the standard active-crustal form
 *     MMI = IPE_C0 + IPE_C1 * M + IPE_C2 * log10(R_hyp_km)
 * solved for the hypocentral distance at which MMI == FELT_MMI_THRESHOLD, then
 * projected to a surface (epicentral) radius. Coefficients are CALIBRATED so
 * outputs are physically sane (shallow M5 ~70 km, M6.5 ~300 km felt radius) —
 * they are NOT the exact Allen-Wald-Worden (2012) table (unverifiable in this
 * build). This is the single tuning point; swap in published coefficients here.
 * The ring is always rendered as an ESTIMATE (dashed, captioned).
 */
export const FELT_MMI_THRESHOLD = 3.5;
export const IPE_C0 = 2.5;
export const IPE_C1 = 1.5;
export const IPE_C2 = -3.5;
/** Cap so a great-quake estimate ring cannot become absurdly large. */
export const EST_MAX_RADIUS_KM = 1000;
/** Vertices used to approximate the estimate ring circle. */
export const EST_RING_POINTS = 64;
/** Ramer-Douglas-Peucker tolerance (degrees) for embedded footprint geometry. */
export const GEOMETRY_SIMPLIFY_TOLERANCE_DEG = 0.01;
/** Per-event footprint fetch timeout (matches the feed-adapter convention). */
export const FOOTPRINT_FETCH_TIMEOUT_MS = 30_000;
```

- [ ] **Step 5: Add the types to `src/types.ts`**

At the top of `src/types.ts`, add the import:
```ts
import type { FeatureCollection } from "geojson";
```
Add `footprintRef?: string;` to the `Event` interface (after `sourceUrl?: string;`), with this doc comment:
```ts
  /**
   * Feed-supplied URL from which this event's impact footprint can be fetched
   * (USGS detail GeoJSON; GDACS getgeometry). Absent when the feed exposes none
   * or the event has no coordinates. Consumed only by the footprint enrichment.
   */
  footprintRef?: string;
```
Add `footprint?: FootprintSummary;` to the `SurfacedEvent` interface (after `change?...`), with:
```ts
  /**
   * Compact provenance summary of this event's impact area (impact-zones slice).
   * Part of the snapshot (audit) and the panel text. The raw geometry is NOT
   * stored here — it travels separately to the renderer. Absent when no zone.
   */
  footprint?: FootprintSummary;
```
Append the new shared types at the end of `src/types.ts`:
```ts
/** How much to trust an impact area — drives its visual + caption. */
export type FootprintProvenance = "shakemap" | "gdacs" | "estimated";

/** Compact, snapshot-safe description of one event's impact area. */
export interface FootprintSummary {
  provenance: FootprintProvenance;
  /** e.g. "Modeled shaking (USGS ShakeMap)". */
  label: string;
  /** True for the magnitude/depth estimate ring — drives dashed style + caption. */
  isEstimate: boolean;
  /** ShakeMap only: peak modeled intensity across contours. */
  maxMmi?: number;
  /** Estimate ring radius, or a modeled polygon's rough bbox radius. */
  radiusKm?: number;
}

/**
 * A summariser's output: the compact summary plus the normalized geometry
 * (FeatureCollection whose every feature.properties matches the normalized
 * shape in the plan's Global Constraints, minus eventId which fillFootprints
 * stamps). geometry is absent when there is nothing drawable.
 */
export interface FootprintResult {
  summary: FootprintSummary;
  geometry?: FeatureCollection;
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run test/thresholds-footprints.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/thresholds.ts package.json package-lock.json test/thresholds-footprints.test.ts
git commit -m "feat(impact-zones): footprint types, constants, geojson dep"
```

---

### Task 2: Feed adapters capture `footprintRef`

**Files:**
- Modify: `src/feeds/usgs.ts` (add `footprintRef` from `properties.detail`)
- Modify: `src/feeds/gdacs.ts` (add `footprintRef` from `properties.url.geometry`)
- Test: `test/usgs-parse.test.ts`, `test/gdacs-parse.test.ts` (extend)

**Interfaces:**
- Consumes: `Event.footprintRef?` (Task 1).
- Produces: parsed `footprintRef` on USGS + GDACS events.

- [ ] **Step 1: Write failing tests**

Add to `test/usgs-parse.test.ts`:
```ts
it("captures the detail URL as footprintRef", () => {
  const payload = { features: [{
    id: "uw123", properties: {
      mag: 5.1, place: "x", time: Date.UTC(2026, 6, 9),
      detail: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/uw123.geojson",
    }, geometry: { coordinates: [1, 2, 10] },
  }] };
  expect(parseUsgs(payload)[0].footprintRef)
    .toBe("https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/uw123.geojson");
});

it("leaves footprintRef undefined when detail is missing or non-string", () => {
  const payload = { features: [{
    id: "uw123", properties: { mag: 5.1, place: "x", time: Date.UTC(2026, 6, 9), detail: 42 },
    geometry: { coordinates: [1, 2] },
  }] };
  expect(parseUsgs(payload)[0].footprintRef).toBeUndefined();
});
```
Add to `test/gdacs-parse.test.ts`:
```ts
it("captures url.geometry as footprintRef", () => {
  const payload = { features: [{
    properties: {
      eventtype: "TC", eventid: 1001279, fromdate: "2026-07-09T00:00:00",
      country: "China", name: "TC BAVI", alertlevel: "Red",
      url: { geometry: "https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=TC&eventid=1001279&episodeid=33",
             report: "https://www.gdacs.org/report.aspx?eventid=1001279" },
    }, geometry: { coordinates: [129.9, 18.3] },
  }] };
  expect(parseGdacs(payload)[0].footprintRef)
    .toContain("getgeometry?eventtype=TC&eventid=1001279");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/usgs-parse.test.ts test/gdacs-parse.test.ts`
Expected: FAIL — `footprintRef` is `undefined` (property not yet set).

- [ ] **Step 3: Implement — USGS**

In `src/feeds/usgs.ts`, add `url?` already exists; add `detail?: unknown;` to the `UsgsFeature.properties` interface. In the returned object (after `sourceUrl:`), add:
```ts
    footprintRef: typeof props.detail === "string" ? props.detail : undefined,
```

- [ ] **Step 4: Implement — GDACS**

In `src/feeds/gdacs.ts`, extend the `url` field of the `properties` interface to `url?: { report?: unknown; geometry?: unknown } | null;`. After computing `report`, add:
```ts
  const geometryRef = props.url?.geometry;
```
and in the returned object (after `sourceUrl:`), add:
```ts
    footprintRef: typeof geometryRef === "string" ? geometryRef : undefined,
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run test/usgs-parse.test.ts test/gdacs-parse.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/feeds/usgs.ts src/feeds/gdacs.ts test/usgs-parse.test.ts test/gdacs-parse.test.ts
git commit -m "feat(impact-zones): capture footprintRef from USGS detail + GDACS getgeometry"
```

---

### Task 3: Estimate ring (pure)

**Files:**
- Create: `src/footprints/estimate.ts`
- Test: `test/estimate.test.ts`

**Interfaces:**
- Consumes: constants from `src/thresholds.ts` (Task 1); `FootprintResult` type.
- Produces:
  - `estimateFeltRadiusKm(mag: number | undefined, depthKm?: number): number | undefined`
  - `circlePolygon(lon: number, lat: number, radiusKm: number, points: number): GeoJSON.Polygon`
  - `estimateFootprint(lon: number, lat: number, mag: number | undefined, depthKm?: number): FootprintResult | undefined`

- [ ] **Step 1: Write the failing test**

Create `test/estimate.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/estimate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/footprints/estimate.ts`**

```ts
import type { Polygon } from "geojson";
import type { FootprintResult } from "../types.js";
import {
  FELT_MMI_THRESHOLD, IPE_C0, IPE_C1, IPE_C2, EST_MAX_RADIUS_KM, EST_RING_POINTS,
} from "../thresholds.js";

/** Muted estimate colour (independent of the CSS tier ramp — client reads it). */
export const ESTIMATE_COLOUR = "#7d95b5";

const EARTH_RADIUS_KM = 6371;

/**
 * Surface (epicentral) felt radius in km, or undefined when no drawable ring.
 * Depth-aware IPE (see thresholds.ts): solve MMI==FELT_MMI_THRESHOLD for the
 * hypocentral distance, then project to the surface. An explicit ESTIMATE.
 */
export function estimateFeltRadiusKm(
  mag: number | undefined,
  depthKm = 0,
): number | undefined {
  if (typeof mag !== "number" || !Number.isFinite(mag)) return undefined;
  // FELT = C0 + C1*M + C2*log10(Rhyp)  =>  Rhyp = 10 ^ ((FELT - C0 - C1*M)/C2)
  const logR = (FELT_MMI_THRESHOLD - IPE_C0 - IPE_C1 * mag) / IPE_C2;
  const rHyp = Math.pow(10, logR);
  const h = Number.isFinite(depthKm) && depthKm > 0 ? depthKm : 0;
  if (rHyp <= h) return undefined;            // too deep to be felt at threshold
  const rEpi = Math.sqrt(rHyp * rHyp - h * h);
  const capped = Math.min(rEpi, EST_MAX_RADIUS_KM);
  return capped > 0 ? capped : undefined;
}

/** A closed circular ring (points+1 positions) approximating a geodesic circle. */
export function circlePolygon(
  lon: number, lat: number, radiusKm: number, points: number,
): Polygon {
  const latRad = (lat * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const brng = (2 * Math.PI * i) / points;
    const dLat = (radiusKm / EARTH_RADIUS_KM) * Math.cos(brng);
    const dLon =
      (radiusKm / (EARTH_RADIUS_KM * Math.cos(latRad))) * Math.sin(brng);
    ring.push([lon + (dLon * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** Estimate footprint for an earthquake, or undefined when nothing is drawable. */
export function estimateFootprint(
  lon: number, lat: number, mag: number | undefined, depthKm = 0,
): FootprintResult | undefined {
  const r = estimateFeltRadiusKm(mag, depthKm);
  if (r === undefined) return undefined;
  const ring = circlePolygon(lon, lat, r, EST_RING_POINTS);
  return {
    summary: {
      provenance: "estimated",
      label: "Estimated felt radius",
      isEstimate: true,
      radiusKm: Math.round(r),
    },
    geometry: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: ring,
        properties: { provenance: "estimated", isEstimate: true, color: ESTIMATE_COLOUR },
      }],
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/estimate.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/footprints/estimate.ts test/estimate.test.ts
git commit -m "feat(impact-zones): depth-aware estimate felt-radius ring (pure)"
```

---

### Task 4: Geometry simplification (pure)

**Files:**
- Create: `src/footprints/simplify.ts`
- Test: `test/simplify.test.ts`

**Interfaces:**
- Produces:
  - `simplifyGeometry(geometry: GeoJSON.Geometry, toleranceDeg: number): GeoJSON.Geometry`
  - `eachPosition(geometry: GeoJSON.Geometry, fn: (pos: number[]) => void): void`

- [ ] **Step 1: Write the failing test**

Create `test/simplify.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/simplify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/footprints/simplify.ts`**

```ts
import type { Geometry, Position } from "geojson";

/** Perpendicular distance from point p to the segment a→b (planar, degrees). */
function segDist(p: Position, a: Position, b: Position): number {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + tc * dx), py - (ay + tc * dy));
}

/** Ramer-Douglas-Peucker on a single line of positions. Endpoints preserved. */
function rdp(points: Position[], tol: number): Position[] {
  if (points.length <= 2) return points;
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]];
  const left = rdp(points.slice(0, idx + 1), tol);
  const right = rdp(points.slice(idx), tol);
  return left.slice(0, -1).concat(right);
}

/** Simplify any GeoJSON geometry's coordinate arrays with RDP (tolerance in degrees). */
export function simplifyGeometry(geometry: Geometry, toleranceDeg: number): Geometry {
  switch (geometry.type) {
    case "LineString":
      return { type: "LineString", coordinates: rdp(geometry.coordinates, toleranceDeg) };
    case "MultiLineString":
      return { type: "MultiLineString", coordinates: geometry.coordinates.map((l) => rdp(l, toleranceDeg)) };
    case "Polygon":
      return { type: "Polygon", coordinates: geometry.coordinates.map((r) => rdp(r, toleranceDeg)) };
    case "MultiPolygon":
      return { type: "MultiPolygon", coordinates: geometry.coordinates.map((poly) => poly.map((r) => rdp(r, toleranceDeg))) };
    default:
      return geometry; // Point / GeometryCollection etc. pass through untouched
  }
}

/** Visit every Position in a geometry (Point/Line/Poly/Multi*). */
export function eachPosition(geometry: Geometry, fn: (pos: Position) => void): void {
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") { fn(c as Position); return; }
    if (Array.isArray(c)) c.forEach(walk);
  };
  if ("coordinates" in geometry) walk((geometry as { coordinates: unknown }).coordinates);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/simplify.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/footprints/simplify.ts test/simplify.test.ts
git commit -m "feat(impact-zones): RDP geometry simplification (pure)"
```

---

### Task 5: ShakeMap summariser (pure)

**Files:**
- Create: `src/footprints/shakemap.ts`
- Test: `test/footprint-shakemap.test.ts`

**Interfaces:**
- Consumes: `simplifyGeometry` (Task 4), `GEOMETRY_SIMPLIFY_TOLERANCE_DEG`, `FootprintResult`.
- Produces: `summariseShakeMap(contFc: unknown): FootprintResult | undefined` (input is the parsed `cont_mmi.json` FeatureCollection).

- [ ] **Step 1: Write the failing test**

Create `test/footprint-shakemap.test.ts`. The fixture mirrors the real `cont_mmi.json` shape (MultiLineString features with `{value, units, color, weight}`):
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/footprint-shakemap.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/footprints/shakemap.ts`**

```ts
import type { Feature, FeatureCollection } from "geojson";
import type { FootprintResult } from "../types.js";
import { simplifyGeometry } from "./simplify.js";
import { GEOMETRY_SIMPLIFY_TOLERANCE_DEG } from "../thresholds.js";

const LINE_TYPES = new Set(["LineString", "MultiLineString"]);
const DEFAULT_COLOUR = "#38bdf8";

/** Parsed cont_mmi.json → normalized modeled-shaking footprint, or undefined. */
export function summariseShakeMap(contFc: unknown): FootprintResult | undefined {
  const features = (contFc as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return undefined;

  const out: Feature[] = [];
  let maxMmi = -Infinity;
  for (const raw of features) {
    const f = raw as { properties?: { value?: unknown; color?: unknown }; geometry?: { type?: string } };
    if (!f.geometry || !LINE_TYPES.has(f.geometry.type ?? "")) continue;
    const value = f.properties?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    maxMmi = Math.max(maxMmi, value);
    out.push({
      type: "Feature",
      geometry: simplifyGeometry(f.geometry as any, GEOMETRY_SIMPLIFY_TOLERANCE_DEG),
      properties: {
        provenance: "shakemap",
        isEstimate: false,
        color: typeof f.properties?.color === "string" ? f.properties.color : DEFAULT_COLOUR,
      },
    });
  }
  if (out.length === 0) return undefined;

  const geometry: FeatureCollection = { type: "FeatureCollection", features: out };
  return {
    summary: { provenance: "shakemap", label: "Modeled shaking (USGS ShakeMap)", isEstimate: false, maxMmi },
    geometry,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/footprint-shakemap.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/footprints/shakemap.ts test/footprint-shakemap.test.ts
git commit -m "feat(impact-zones): ShakeMap MMI-contour summariser (pure)"
```

---

### Task 6: GDACS geometry summariser (pure)

**Files:**
- Create: `src/footprints/gdacs.ts`
- Test: `test/footprint-gdacs.test.ts`

**Interfaces:**
- Consumes: `simplifyGeometry`, `eachPosition` (Task 4), `GEOMETRY_SIMPLIFY_TOLERANCE_DEG`, `FootprintResult`.
- Produces: `summariseGdacsGeometry(fc: unknown, hazardType: string): FootprintResult | undefined`.

- [ ] **Step 1: Write the failing test**

Create `test/footprint-gdacs.test.ts`. Fixture mirrors the real getgeometry shape (a centroid Point to be dropped + an alert-coloured Polygon + a track LineString):
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/footprint-gdacs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/footprints/gdacs.ts`**

```ts
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { FootprintResult } from "../types.js";
import { simplifyGeometry, eachPosition } from "./simplify.js";
import { GEOMETRY_SIMPLIFY_TOLERANCE_DEG } from "../thresholds.js";

const AREA_TYPES = new Set(["Polygon", "MultiPolygon", "LineString", "MultiLineString"]);

const HAZARD_LABELS: Record<string, string> = {
  EQ: "earthquake", TC: "tropical cyclone", FL: "flood", WF: "wildfire",
  VO: "volcano", DR: "drought", TS: "tsunami",
};

function alertColour(level: unknown): string {
  switch (typeof level === "string" ? level.toLowerCase() : "") {
    case "red": return "#ef4444";
    case "orange": return "#f59e0b";
    case "green": return "#22c55e";
    default: return "#38bdf8";
  }
}

/** Rough km radius = half the bbox diagonal (equirectangular approximation). */
function bboxRadiusKm(features: Feature[]): number {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const f of features) {
    eachPosition(f.geometry, (p: Position) => {
      minLon = Math.min(minLon, p[0]); maxLon = Math.max(maxLon, p[0]);
      minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]);
    });
  }
  if (!Number.isFinite(minLon)) return 0;
  const midLat = ((minLat + maxLat) / 2) * Math.PI / 180;
  const dLatKm = (maxLat - minLat) * 111;
  const dLonKm = (maxLon - minLon) * 111 * Math.cos(midLat);
  return Math.round(Math.hypot(dLatKm, dLonKm) / 2);
}

/** getgeometry FeatureCollection → normalized modeled-area footprint, or undefined. */
export function summariseGdacsGeometry(fc: unknown, hazardType: string): FootprintResult | undefined {
  const features = (fc as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return undefined;

  const kept: Feature[] = [];
  for (const raw of features) {
    const f = raw as { properties?: { alertlevel?: unknown }; geometry?: Geometry };
    if (!f.geometry || !AREA_TYPES.has(f.geometry.type)) continue;   // drop centroid Point
    kept.push({
      type: "Feature",
      geometry: simplifyGeometry(f.geometry, GEOMETRY_SIMPLIFY_TOLERANCE_DEG),
      properties: { provenance: "gdacs", isEstimate: false, color: alertColour(f.properties?.alertlevel) },
    });
  }
  if (kept.length === 0) return undefined;

  const hazard = HAZARD_LABELS[hazardType] ?? hazardType;
  const geometry: FeatureCollection = { type: "FeatureCollection", features: kept };
  return {
    summary: {
      provenance: "gdacs",
      label: `Modeled affected area (GDACS · ${hazard})`,
      isEstimate: false,
      radiusKm: bboxRadiusKm(kept),
    },
    geometry,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/footprint-gdacs.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/footprints/gdacs.ts test/footprint-gdacs.test.ts
git commit -m "feat(impact-zones): GDACS getgeometry summariser (pure)"
```

---

### Task 7: `fillFootprints` + `FootprintSource` + HTTP adapter

**Files:**
- Create: `src/footprints/fill.ts` (pure orchestration + `FootprintSource` type)
- Create: `src/footprints/source.ts` (networked adapter — thin, not unit-tested)
- Test: `test/fill-footprints.test.ts`

**Interfaces:**
- Consumes: `estimateFootprint` (T3), `summariseShakeMap` (T5), `summariseGdacsGeometry` (T6), `FootprintResult`, `SitrepModel`, `SurfacedEvent`, `FOOTPRINT_FETCH_TIMEOUT_MS`.
- Produces:
  - `type FootprintSource = { forEvent(event: SurfacedEvent): Promise<FootprintResult | undefined> }`
  - `fillFootprints(model: SitrepModel, source: FootprintSource): Promise<{ model: SitrepModel; geometryById: Record<string, FeatureCollection> }>`
  - `footprintKey(event: { feed: string; feedEventId: string }): string`  → `` `${feed} ${feedEventId}` ``
  - `httpFootprintSource: FootprintSource` (in source.ts)

- [ ] **Step 1: Write the failing test**

Create `test/fill-footprints.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/fill-footprints.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/footprints/fill.ts`**

```ts
import type { FeatureCollection } from "geojson";
import type { FootprintResult, SitrepModel, SurfacedEvent } from "../types.js";

/** Networked footprint fetch, injected so the seam stays testable (no network in tests). */
export interface FootprintSource {
  /** Never throws in production; fillFootprints also guards. undefined = no zone. */
  forEvent(event: SurfacedEvent): Promise<FootprintResult | undefined>;
}

/** Composite identity — space separator, matching src/core/changes.ts. */
export function footprintKey(event: { feed: string; feedEventId: string }): string {
  return `${event.feed} ${event.feedEventId}`;
}

/**
 * Attach a FootprintSummary to each surfaced event and collect normalized
 * geometry keyed by footprint key. Never throws: a source failure per event
 * degrades that event to no zone (CLAUDE.md #4). Returns a fresh model.
 */
export async function fillFootprints(
  model: SitrepModel,
  source: FootprintSource,
): Promise<{ model: SitrepModel; geometryById: Record<string, FeatureCollection> }> {
  if (model.surfaced.length === 0) return { model: { ...model }, geometryById: {} };

  const geometryById: Record<string, FeatureCollection> = {};
  const surfaced = await Promise.all(
    model.surfaced.map(async (e) => {
      let result: FootprintResult | undefined;
      try {
        result = await source.forEvent(e);
      } catch (err) {
        console.error(`footprint fetch failed for ${footprintKey(e)}: ${String(err)}`);
      }
      if (!result) return { ...e };
      if (result.geometry) {
        const key = footprintKey(e);
        // Stamp the key onto every feature so the client can filter by eventId.
        geometryById[key] = {
          type: "FeatureCollection",
          features: result.geometry.features.map((f) => ({
            ...f,
            properties: { ...(f.properties ?? {}), eventId: key },
          })),
        };
      }
      return { ...e, footprint: result.summary };
    }),
  );
  return { model: { ...model, surfaced }, geometryById };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/fill-footprints.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Implement the HTTP adapter `src/footprints/source.ts` (not unit-tested)**

```ts
import type { FootprintResult, SurfacedEvent } from "../types.js";
import type { FootprintSource } from "./fill.js";
import { summariseShakeMap } from "./shakemap.js";
import { summariseGdacsGeometry } from "./gdacs.js";
import { estimateFootprint } from "./estimate.js";
import { FOOTPRINT_FETCH_TIMEOUT_MS } from "../thresholds.js";

const UA = { "user-agent": "hadr-monitor (workshop build)" };

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(FOOTPRINT_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** USGS: follow the detail feed → ShakeMap cont_mmi.json; else estimate ring. */
async function usgsFootprint(event: SurfacedEvent): Promise<FootprintResult | undefined> {
  const { coordinates: c, metrics } = event;
  const estimate = () => (c ? estimateFootprint(c.lon, c.lat, metrics.mag, c.depthKm) : undefined);
  if (!event.footprintRef) return estimate();
  try {
    const detail = await getJson(event.footprintRef);
    const products = (detail as any)?.properties?.products;
    const contUrl = products?.shakemap?.[0]?.contents?.["download/cont_mmi.json"]?.url;
    if (typeof contUrl === "string") {
      const summary = summariseShakeMap(await getJson(contUrl));
      if (summary) return summary;
    }
  } catch (err) {
    console.error(`USGS footprint fetch failed for ${event.feedEventId}: ${String(err)}`);
  }
  return estimate(); // no ShakeMap (tiny quake) or fetch failed → estimate ring
}

/** GDACS: fetch getgeometry → normalized polygons. No estimate fallback. */
async function gdacsFootprint(event: SurfacedEvent): Promise<FootprintResult | undefined> {
  if (!event.footprintRef) return undefined;
  try {
    return summariseGdacsGeometry(await getJson(event.footprintRef), event.hazardType);
  } catch (err) {
    console.error(`GDACS footprint fetch failed for ${event.feedEventId}: ${String(err)}`);
    return undefined;
  }
}

/** Production source. ReliefWeb (no coords) always yields no zone. */
export const httpFootprintSource: FootprintSource = {
  async forEvent(event) {
    if (!event.coordinates) return undefined;
    if (event.feed === "USGS") return usgsFootprint(event);
    if (event.feed === "GDACS") return gdacsFootprint(event);
    return undefined;
  },
};
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/footprints/fill.ts src/footprints/source.ts test/fill-footprints.test.ts
git commit -m "feat(impact-zones): fillFootprints enrichment + injected HTTP source"
```

---

### Task 8: View-model — card key + footprint summary

**Files:**
- Modify: `src/render/viewModel.ts`
- Test: `test/view-model.test.ts` (extend)

**Interfaces:**
- Consumes: `SurfacedEvent.footprint?` (T1); footprint key convention.
- Produces: `EventCardVM.key: string` and `EventCardVM.footprint: FootprintSummary | null`.

- [ ] **Step 1: Write the failing test**

Add to `test/view-model.test.ts` (adapt the existing `surfaced`/`model` helpers already in that file):
```ts
it("carries a composite footprint key and the footprint summary onto the card", () => {
  const vm = buildViewModel(model({
    surfaced: [surfaced({
      feed: "GDACS", feedEventId: "42",
      footprint: { provenance: "gdacs", label: "Modeled affected area (GDACS · earthquake)", isEstimate: false, radiusKm: 50 },
    })],
  }));
  const card = vm.tiers[0].events[0];
  expect(card.key).toBe("GDACS 42");
  expect(card.footprint!.label).toContain("GDACS");
});

it("sets card.footprint to null when the event has no footprint", () => {
  const vm = buildViewModel(model({ surfaced: [surfaced({})] }));
  expect(vm.tiers[0].events[0].footprint).toBeNull();
});
```
> If `test/view-model.test.ts` lacks local `surfaced`/`model` helpers, copy the ones from `test/render.test.ts` (lines 11-36).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/view-model.test.ts`
Expected: FAIL — `card.key` / `card.footprint` undefined.

- [ ] **Step 3: Implement**

In `src/render/viewModel.ts`: import the type — change the top import to include `FootprintSummary`:
```ts
import type { FeedName, FootprintSummary, SitrepModel, SurfacedEvent, Tier } from "../types.js";
```
Add two fields to `EventCardVM` (after `id: string;`):
```ts
  /** Composite identity `${feed} ${feedEventId}` — used to look up embedded geometry. */
  key: string;
```
and (after `coordinates:` field):
```ts
  /** Impact-area summary (impact-zones slice), or null when the event has no zone. */
  footprint: FootprintSummary | null;
```
In `cardFor`, add to the returned object:
```ts
    key: `${event.feed} ${event.feedEventId}`,
```
and:
```ts
    footprint: event.footprint ?? null,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/view-model.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/viewModel.ts test/view-model.test.ts
git commit -m "feat(impact-zones): expose card footprint key + summary in view-model"
```

---

### Task 9: Renderer — embed geometry, toggle DOM/CSS, permanent caption

**Files:**
- Modify: `src/render/dashboard.ts`
- Test: `test/render.test.ts` (extend)

**Interfaces:**
- Consumes: `geometryById` from `fillFootprints` (T7).
- Produces: `renderDashboard(model: SitrepModel, geometryById?: Record<string, FeatureCollection>): string` — second signature arg (defaults to `{}`).

- [ ] **Step 1: Write the failing test**

Add to `test/render.test.ts`. First update the import to allow passing geometry (no signature import change needed). Add:
```ts
describe("impact zones (impact-zones slice)", () => {
  it("embeds footprint geometry in a second JSON block, `<` escaped, round-tripping", () => {
    const geom = { "USGS h": { type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        properties: { eventId: "USGS h", provenance: "estimated", isEstimate: true, color: "#7d95b5" } }] } };
    const html = renderDashboard(model({ surfaced: [surfaced({ feedEventId: "h" })] }), geom as any);
    const m = /<script id="sitrep-geometry" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual(geom);
  });
  it("renders the in-panel toggle defaulting to off, above the event groups", () => {
    const html = renderDashboard(model({}));
    expect(html).toContain('id="impact-toggle"');
    expect(html).toMatch(/id="impact-toggle"[^>]*aria-pressed="false"/);
    // Toggle wrapper sits before #groups in source order.
    expect(html.indexOf('id="impact-controls"')).toBeLessThan(html.indexOf('id="groups"'));
    expect(html.indexOf('id="impact-controls"')).toBeGreaterThan(html.indexOf('id="notices"'));
  });
  it("always shows the not-an-evacuation-boundary caption", () => {
    expect(renderDashboard(model({}))).toContain("not official evacuation boundaries");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — second script/toggle/caption absent; `renderDashboard` ignores the 2nd arg.

- [ ] **Step 3: Implement — signature + geometry embed**

In `src/render/dashboard.ts`, add the import:
```ts
import type { FeatureCollection } from "geojson";
```
Change the signature and payloads:
```ts
export function renderDashboard(
  model: SitrepModel,
  geometryById: Record<string, FeatureCollection> = {},
): string {
  const payload = JSON.stringify(buildViewModel(model)).replace(/</g, "\\u003c");
  const geomPayload = JSON.stringify(geometryById).replace(/</g, "\\u003c");
```
Add the geometry `<script>` right after the existing `#sitrep-data` script:
```html
<script id="sitrep-geometry" type="application/json">${geomPayload}</script>
```

- [ ] **Step 4: Implement — toggle DOM in the panel**

In the `#panel` markup, insert **between `<div id="changes"></div>` and `<div id="groups"></div>`**:
```html
  <div id="impact-controls">
    <button id="impact-toggle" type="button" aria-pressed="false">Impact areas: off</button>
    <div id="impact-legend">
      <span class="key modeled">modeled</span>
      <span class="key estimate">estimate</span>
    </div>
    <p class="impact-caption">Modeled or estimated extents — not official evacuation boundaries.</p>
  </div>
```

- [ ] **Step 5: Implement — CSS**

Append to `THEME_CSS`:
```css
  #impact-controls { padding: 0.5rem 1.25rem 0; }
  #impact-toggle {
    width: 100%; text-align: left; background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 0.45rem 0.7rem;
    font-size: 0.8rem; cursor: pointer;
  }
  #impact-toggle[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
  #impact-legend { display: flex; gap: 0.75rem; margin: 0.4rem 0 0; font-size: 0.7rem; color: var(--muted); }
  #impact-legend .key::before {
    content: ""; display: inline-block; width: 14px; height: 0; vertical-align: middle;
    margin-right: 0.3rem; border-top: 2px solid var(--muted);
  }
  #impact-legend .key.estimate::before { border-top-style: dashed; }
  .impact-caption { margin: 0.35rem 0 0; font-size: 0.68rem; color: var(--muted); font-style: italic; }
  .row .footprint, .card .footprint { color: var(--muted); font-size: 0.74rem; margin: 0.3rem 0 0; }
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run test/render.test.ts && npx tsc --noEmit`
Expected: PASS. (The existing `#sitrep-data` round-trip test still passes — that payload is unchanged.)

- [ ] **Step 7: Commit**

```bash
git add src/render/dashboard.ts test/render.test.ts
git commit -m "feat(impact-zones): embed footprint geometry + in-panel toggle + caption"
```

---

### Task 10: Client — impact layers, selection filter, toggle, panel text

**Files:**
- Modify: `src/render/client.ts`
- Test: `test/render.test.ts` (extend — the client script is inlined into the page; assert presence, since tests run no browser per the existing deviation)

**Interfaces:**
- Consumes: embedded `#sitrep-geometry` (T9); `card.key` + `card.footprint` (T8).
- Produces: no exported API change; behaviour only.

- [ ] **Step 1: Write the failing test (presence assertions)**

Add to `test/render.test.ts` inside the impact-zones describe:
```ts
it("wires a single impact source with data-driven paint and a default hide-all filter", () => {
  const html = renderDashboard(model({}));
  expect(html).toContain("sitrep-geometry");           // client reads the 2nd block
  expect(html).toContain('addSource("impact"');
  expect(html).toContain("line-dasharray");            // estimate styling hook
  expect(html).toContain('["get", "eventId"]');        // selection filter expression
  expect(html).toContain('["get", "color"]');          // data-driven colour
  expect(html).toContain("impact-toggle");             // toggle wired
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — client does not yet reference these.

- [ ] **Step 3: Implement — parse geometry + state**

In `src/render/client.ts`, after the `vm = JSON.parse(...)` block, add geometry parsing and impact state:
```js
  var geometry = {};
  try {
    var geomNode = document.getElementById("sitrep-geometry");
    if (geomNode) geometry = JSON.parse(geomNode.textContent);
  } catch (e) { geometry = {}; }

  var impactMode = "hide";   // "hide" (selection-driven, default) | "show"
  var activeKey = null;      // footprint key of the selected event, or null
  var NONE_KEY = " none";
```

- [ ] **Step 4: Implement — selection sets activeKey**

In `flyToEvent`, set the active key and refresh the overlay. Replace the body of `flyToEvent` with:
```js
  function flyToEvent(ev) {
    activeKey = ev.key;
    refreshImpact();
    if (!map || !ev.coordinates) return;
    map.flyTo({ center: [ev.coordinates.lon, ev.coordinates.lat], zoom: 5 });
    openCard(ev);
  }
```
In the marker click handler (inside `withCoords.forEach`), set the active key too — replace the handler body:
```js
      dot.addEventListener("click", function (e) {
        e.stopPropagation();
        activeKey = ev.key;
        refreshImpact();
        openCard(ev);
      });
```

- [ ] **Step 5: Implement — panel + card footprint text**

Add a helper near `el`:
```js
  var ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  function footprintText(fp) {
    if (!fp) return null;
    var t = fp.label;
    if (typeof fp.maxMmi === "number") {
      var n = Math.max(0, Math.min(10, Math.round(fp.maxMmi)));
      t += " · reached MMI " + (ROMAN[n] || n);
    } else if (typeof fp.radiusKm === "number") {
      t += " · ~" + fp.radiusKm + " km";
    }
    if (fp.isEstimate) t += " · estimate, not an evacuation boundary";
    return t;
  }
```
In `buildCard`, before the `sourceUrl` block, add:
```js
    var fpText = footprintText(ev.footprint);
    if (fpText) card.appendChild(el("p", "footprint", fpText));
```
In the panel row builder (inside `group.events.forEach`), after the `changeNote` line, add:
```js
      var rowFp = footprintText(ev.footprint);
      if (rowFp) row.appendChild(el("div", "footprint", rowFp));
```

- [ ] **Step 6: Implement — the impact source/layers + refresh + toggle**

Inside the `map.on("load", ...)` callback, BEFORE the fitBounds logic, add the source + layers:
```js
      var allFeatures = [];
      Object.keys(geometry).forEach(function (k) {
        var fc = geometry[k];
        if (fc && fc.features) allFeatures = allFeatures.concat(fc.features);
      });
      map.addSource("impact", { type: "geojson", data: { type: "FeatureCollection", features: allFeatures } });
      map.addLayer({
        id: "impact-fill", type: "fill", source: "impact",
        filter: ["==", "$type", "Polygon"],
        paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "isEstimate"], 0.08, 0.18] },
      });
      map.addLayer({
        id: "impact-line", type: "line", source: "impact",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-dasharray": ["case", ["get", "isEstimate"], ["literal", [2, 2]], ["literal", [1, 0]]],
        },
      });
      refreshImpact();
```
Add `refreshImpact` as a top-level function in the IIFE (near `openPanel`):
```js
  function refreshImpact() {
    if (!map || !map.getLayer || !map.getLayer("impact-fill")) return;
    var visFilter = impactMode === "show"
      ? null
      : ["==", ["get", "eventId"], activeKey || NONE_KEY];
    var polyFilter = impactMode === "show"
      ? ["==", "$type", "Polygon"]
      : ["all", ["==", "$type", "Polygon"], ["==", ["get", "eventId"], activeKey || NONE_KEY]];
    map.setFilter("impact-line", visFilter);
    map.setFilter("impact-fill", polyFilter);
  }
```
Wire the toggle button near the other rail/button wiring:
```js
  var impactBtn = document.getElementById("impact-toggle");
  if (impactBtn) {
    impactBtn.addEventListener("click", function () {
      impactMode = impactMode === "show" ? "hide" : "show";
      var on = impactMode === "show";
      impactBtn.setAttribute("aria-pressed", on ? "true" : "false");
      impactBtn.textContent = "Impact areas: " + (on ? "on" : "off");
      refreshImpact();
    });
  }
```

- [ ] **Step 7: Run tests + build a live preview**

Run: `npx vitest run test/render.test.ts && npx tsc --noEmit`
Expected: PASS.
Then a manual smoke build (no network needed — uses fixtures? No; use the run only if you want a live check). At minimum verify the client string compiles into the page. The full interactive behaviour is validated in the live run (Task 11) per the existing "client is not unit-tested" deviation.

- [ ] **Step 8: Commit**

```bash
git add src/render/client.ts test/render.test.ts
git commit -m "feat(impact-zones): client impact layers, selection filter, toggle, panel text"
```

---

### Task 11: Wire into `run.ts` + docs

**Files:**
- Modify: `src/run.ts`
- Modify: `implementation-notes.md` (Deviations)
- Modify: `docs/PRD.md` (note the post-v1 feature — optional, see step)
- Test: `test/render.test.ts` already covers the render path; add one integration assertion in a new `test/impact-zones-integration.test.ts` exercising fillFootprints→renderDashboard with a fake source.

**Interfaces:**
- Consumes: `fillFootprints` (T7), `httpFootprintSource` (T7), `renderDashboard(model, geometryById)` (T9).

- [ ] **Step 1: Write the failing integration test**

Create `test/impact-zones-integration.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/impact-zones-integration.test.ts`
Expected: FAIL — until `fillFootprints`+`renderDashboard` interplay is confirmed. (It should actually pass already since T7+T9 are done; if so, this is a characterization test — keep it, it guards the wiring.)

- [ ] **Step 3: Wire `run.ts`**

In `src/run.ts`, add imports:
```ts
import { fillFootprints } from "./footprints/fill.js";
import { httpFootprintSource } from "./footprints/source.js";
```
Replace the assessment/render/snapshot block (current lines ~46-59) with:
```ts
  const force = process.env.FORCE === "true";
  const assess = shouldAssess(model.changeSummary, force);
  console.log(
    assess
      ? "writing assessments (change detected, first run, or forced)"
      : "quiet run — carrying forward prior assessments (no model call)",
  );

  // Footprints are deterministic I/O, not the LLM — fetched every run,
  // independent of the quiet-gate (CLAUDE.md #2). Failures degrade to no zone.
  const { model: withFootprints, geometryById } = await fillFootprints(model, httpFootprintSource);

  const assessed = assess
    ? await fillAssessments(withFootprints, claudeCliWriter)
    : carryForwardAssessments(withFootprints, prior);
  writeFileSync("dashboard.html", renderDashboard(assessed, geometryById), "utf8");
  writeSnapshot("data", now, assessed);
  console.log("wrote dashboard.html and data snapshot");
```
> `fillAssessments` and `carryForwardAssessments` both spread `...e`, so the `footprint` field added by `fillFootprints` survives both paths. Confirm by reading `src/assessment/gate.ts` — `carryForwardAssessments` must map with `{ ...e, assessment: ... }` (it does per the existing implementation); if it reconstructs events field-by-field instead, add `footprint: e.footprint` there.

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 5: Record the Deviation + open question in `implementation-notes.md`**

Under **Deviations**, add:
```markdown
- **2026-07-09 — Estimate ring uses a calibrated IPE, not the exact AWW-2012 table.**
  The impact-zones spec named Allen-Wald-Worden (2012) as the depth-aware IPE for the
  estimated felt-radius ring. The paper's coefficient table could not be verified in
  this build, so `estimateFeltRadiusKm` uses the standard active-crustal form
  `MMI = IPE_C0 + IPE_C1*M + IPE_C2*log10(R_hyp)` with coefficients CALIBRATED to
  physically-sane felt radii (shallow M5 ~70 km, M6.5 ~300 km), constants in
  `thresholds.ts`. The ring is always rendered as an ESTIMATE (dashed, captioned "not
  an evacuation boundary"), so fidelity is bounded and honest. Swapping in published
  coefficients is a one-line change to `IPE_C0/C1/C2`. Tracked.
- **2026-07-09 — GDACS footprint radiusKm is a rough bbox radius.** `summariseGdacsGeometry`
  reports half the bbox diagonal, not a hazard-specific affected radius. Panel text only;
  the drawn polygon is the authoritative extent.
```

- [ ] **Step 6: Update `docs/PRD.md` scope note (optional but preferred)**

In the "Out of Scope" or a "Post-v1" note, record that confidence-tiered impact zones shipped post-v1 with the spec reference `docs/superpowers/specs/2026-07-09-impact-zones-design.md`. Keep it one line; do not restructure the PRD.

- [ ] **Step 7: Commit**

```bash
git add src/run.ts implementation-notes.md docs/PRD.md test/impact-zones-integration.test.ts
git commit -m "feat(impact-zones): wire fillFootprints into the run + record deviations"
```

- [ ] **Step 8: Live validation (manual, outside CI)**

Run: `FORCE=true npm run sitrep` (needs network + `claude` CLI). Then open `dashboard.html`.
Expected: page renders; selecting a USGS/GDACS event with coordinates draws its zone; the toggle flips all zones on/off; the caption is visible; a quiet/failed footprint fetch leaves the event listed with no zone and never crashes the run. Note: the primary dev machine has NO WebGL — verify the **panel footprint text** appears there (the map overlay cannot render locally); use a WebGL-capable environment or `chrome --headless=new --disable-gpu` *with* software rasterizer allowed to see the overlay.

---

## Self-Review

**1. Spec coverage.**
- Confidence tiers (shakemap/gdacs/estimated/none) → Tasks 3, 5, 6, 7. ✔
- Never-overstate framing + permanent caption + estimate dashing → Tasks 9, 10 (caption test, `line-dasharray`). ✔
- Pure core untouched; enrichment in run.ts behind injected source → Tasks 7, 11. ✔
- Type additions (`FootprintSummary`, `footprint?`, `footprintRef?`) → Task 1. ✔
- USGS ShakeMap + fallback to estimate → Tasks 5, 7 (`usgsFootprint`). ✔
- GDACS all hazards, uniform path → Task 6. ✔
- ReliefWeb none → Task 7 (`forEvent` returns undefined for non-USGS/GDACS). ✔
- Build-time embed, summary-only snapshot → Tasks 7 (geometry side map, summary on model), 9 (embed), 11 (`writeSnapshot(assessed)` carries only summaries). ✔
- Selection-driven + show/hide-all toggle, default hide-all, in-panel between header and list → Tasks 9 (placement test), 10 (filter logic). ✔
- No-WebGL panel text → Task 10 (`footprintText` in rows/cards). ✔
- Never fail silently → Tasks 7 (per-event try/catch, undefined), 11. ✔
- Named constants → Task 1. ✔
- Testing at the seam → every pure module has a fixture-driven test; client asserted by presence. ✔
- Out-of-scope items (PAGER numbers, client fetch, animation) → not built. ✔

**2. Placeholder scan.** No "TBD"/"handle errors"/"similar to". The one narrative note in Task 3 (collapse the double import) is an explicit instruction with the exact final behaviour stated; acceptable. Fixtures are concrete literals.

**3. Type consistency.** `footprintKey`/`key` = `` `${feed} ${feedEventId}` `` (space) used consistently in Tasks 7, 8, 11. `FootprintResult`/`FootprintSummary` shapes identical across Tasks 1, 3, 5, 6, 7. `renderDashboard(model, geometryById)` signature consistent in Tasks 9, 10, 11. Normalized feature `properties` (`eventId`/`provenance`/`isEstimate`/`color`) consistent between summarisers (no eventId), `fillFootprints` (stamps eventId), and the client paint expressions (`["get","eventId"]`, `["get","color"]`, `["get","isEstimate"]`). ✔

## Notes for the executor

- Tasks 3–6 are mutually independent pure modules; if executing with subagents, they can be reviewed in any order, but Task 4 (simplify) must land before Tasks 5 and 6 (they import it).
- The estimate coefficients are deliberately approximate and honest — do NOT relabel the ring as anything stronger than "estimate".
- Do not evade any feed's rate-limiting or bot-shield when adding footprint fetches; the single-request-with-timeout pattern (no retry) matches the existing ADR 0008 deviation.
