# Impact Zones (confidence-tiered impact areas) — Design Spec

**Date:** 2026-07-09
**Status:** Approved (brainstorming), pending implementation plan.
**Depends on:** v1 complete (ADR 0010 build order done). Not part of v1 scope;
this is the first post-v1 feature slice.

## Goal

For each surfaced, coordinate-bearing event, optionally show a **modeled or
estimated impact area** on the map — the geographic extent over which the hazard
is felt/affects people. Zones are drawn **only for the event the user selects**
(card or marker click), never all at once. Every zone is labeled by its data
**provenance** so the map itself communicates how much to trust it.

## The cardinal constraint

An impact area is **not** an evacuation boundary. ShakeMap contours are *modeled
shaking intensity*; GDACS polygons are *modeled affected area*; a magnitude ring
is a *rough felt estimate*. Presenting any of them as an operational
evacuation/danger directive would overstate what the data supports — the exact
failure the project forbids (PRD cardinal + secondary rule; CLAUDE.md #5). The
feature is therefore framed throughout as **"modeled / estimated impact area,"**
with a permanent legend caption:

> *Impact areas are modeled or estimated hazard extents — not official
> evacuation boundaries.*

## Confidence tiers

| Tier | Source | Map style | Panel-text example |
|---|---|---|---|
| **Modeled — shaking** | USGS ShakeMap `cont_mmi.json` | Solid fill, MMI colour ramp | "Modeled shaking · reached MMI VI" |
| **Modeled — affected area** | GDACS `getgeometry` polygon | Solid fill, hazard colour | "Modeled affected area (GDACS · cyclone)" |
| **Estimate** | Computed magnitude/depth ring | **Dashed**, muted | "Estimated felt radius ~120 km · *estimate, not an evacuation boundary*" |
| **None** | No coordinates / no data available | (no overlay) | (event still listed, no zone) |

## Data sources (verified live 2026-07-09)

### USGS earthquakes — ShakeMap MMI contours
- The summary feed (`all_day.geojson`, already fetched) carries
  `properties.detail` → per-event detail GeoJSON.
- Detail `properties.products.shakemap[0].contents["download/cont_mmi.json"]`
  is a GeoJSON of modeled shaking-intensity (MMI) contour lines. Confirmed
  present even on a small M3.8 event.
- `losspager` (PAGER) is **absent on small events** and gives
  population-by-intensity, not a polygon — **out of scope** for the map (§ Out of
  scope). USGS `sig`/PAGER already drive tiering; nothing changes there.
- **Fallback:** if no ShakeMap product exists (tiny quakes), the USGS event falls
  back to the **estimated ring** (never leave a quake bare).
- Cost: 2 extra fetches per surfaced USGS event (detail + contour file).

### GDACS — getgeometry polygons (all hazards)
- Every EVENTS4APP event carries `properties.url.geometry` → `getgeometry`
  returning a GeoJSON FeatureCollection containing Polygon feature(s) (plus a
  centroid Point we ignore). Confirmed: EQ returns a shaking polygon; the same
  endpoint returns cyclone wind buffers, flood extent, wildfire area for those
  hazard types — **one uniform adapter path**, hazard-specific label/colour.
- Richer inline `severitydata` (e.g. `{severity: 4.7, severitytext: "Magnitude
  4.7M, Depth:35km"}`) is available but not required by this feature.
- **No estimate fallback for non-EQ GDACS** hazards — there is no defensible
  single-number model for cyclone/flood/wildfire extent.
- Cost: 1 extra fetch per surfaced GDACS event.

### ReliefWeb — none
Country-level, no coordinates (ADR 0008). No impact zone, ever.

### Estimated ring (earthquakes only)
- A **pure, unit-tested** function computes a felt radius from magnitude,
  attenuated by hypocentral depth, using a **published depth-aware intensity
  prediction equation (IPE)** — default **Allen, Wald & Worden (2012)** — solved
  for the distance at which median intensity falls to `FELT_MMI_THRESHOLD`
  (default MMI 3.5, "felt"). Deeper quakes yield a smaller surface radius
  (correct physics, since the IPE uses hypocentral distance).
- The exact coefficients and threshold are pinned in the implementation plan and
  locked by a unit test against a small hand-computed table.
- No magnitude available → no ring.
- Rendered dashed/muted and always captioned as an estimate.

## Architecture — the pure core stays untouched

`buildSitrep` makes **no network call** (CLAUDE.md #1). Footprints are an
**enrichment step in `run.ts`, after** the core selects surfaced events —
mirroring `fillAssessments`:

```
buildSitrep(feedResults, priorSnapshot, now) → SitrepModel
        │
        ├─► fillAssessments(model, writer)            [LLM]
        └─► fillFootprints(model, footprintSource)    [network]
                     │
                     ▼
   writeSnapshot(summary only)  +  renderDashboard(model, geometryById)
```

- Footprints are fetched **only for surfaced events** (~20/day), never the ~200
  raw events.
- `fillFootprints` runs on **every scheduled run**, independent of the
  quiet-gate. The gate governs **the LLM only** (CLAUDE.md #2); footprint fetch
  is deterministic I/O, so there is no carry-forward complexity for geometry.
- Network sits behind an **injected `FootprintSource` interface** (same pattern
  as `ReliefWebSource`, CLAUDE.md #7). Parse/summarise logic is fixture-tested
  with **no network in tests** (CLAUDE.md test rule).
- Change detection (ADR 0009) is untouched: footprints are enrichment, not
  identity; `changes.ts` does not read them.

### Injected seam

```ts
/** One event's fetched impact geometry + its summary. */
interface FootprintResult {
  summary: FootprintSummary;          // → snapshot + panel text
  geometry?: GeoJSON.FeatureCollection; // raw, simplified; → renderer only
}

/** Networked adapter, injected into fillFootprints (never called in tests). */
interface FootprintSource {
  /** Never throws: failure resolves to `undefined` (event shows no modeled zone). */
  forEvent(event: SurfacedEvent): Promise<FootprintResult | undefined>;
}
```

## Type additions (seam contract)

```ts
type FootprintProvenance = "shakemap" | "gdacs" | "estimated";

interface FootprintSummary {
  provenance: FootprintProvenance;
  label: string;        // "Modeled shaking (USGS ShakeMap)"; hazard-specific for GDACS
  isEstimate: boolean;  // drives dashed style + estimate caption
  maxMmi?: number;      // ShakeMap
  radiusKm?: number;    // estimate ring, or bbox radius of a modeled polygon
}
```

- `SurfacedEvent` gains `footprint?: FootprintSummary`. The **summary** is part of
  `SitrepModel`, so it lands in `data/YYYY-MM-DD.json` (audit) and the panel text.
- The **raw GeoJSON** is *not* stored in the snapshot. `fillFootprints` returns a
  side map `geometryById: Record<string, GeoJSON.FeatureCollection>` keyed by
  `` `${feed} ${feedEventId}` `` (the project's composite identity), passed only to
  `renderDashboard` for embedding.

## Snapshot & audit

- Snapshot stores only the compact `FootprintSummary` per event — bounded size,
  preserves "what the brief said" (provenance, max MMI, radius).
- Raw polygons live only in the committed/published `dashboard.html`.
- Git growth is bounded by (a) surfaced-events-only, (b) RDP geometry
  simplification before embedding.

## Rendering — selection-driven zones

- **Default:** no impact overlays drawn. Uncluttered map.
- **Selection shows one zone:** clicking an event's **map marker** *or* its
  **card in the panel** makes it the single "active" event → its footprint (and
  estimate ring if that is its tier) is drawn and the map flies to fit it.
  Selecting another event swaps the overlay; deselecting/closing the panel clears
  it. **At most one event's zone is shown at a time.**
- **Mechanism:** all surfaced events' geometry is embedded in the payload; the
  client uses **one reusable MapLibre GeoJSON source** whose data is swapped to
  the active event — not N always-on layers. Two layers on that source: a `fill`
  and a `line`. Solid line + filled for modeled (MMI colour ramp for ShakeMap,
  hazard colour for GDACS); **dashed** line + low-opacity fill for estimate.
- **Legend:** the permanent caption plus a small provenance key
  (modeled-solid / estimate-dashed). No visibility toggle — display is already
  on-demand.
- **All tiers embedded:** Critical/High/Moderate surfaced events all get their
  geometry embedded (only one draws at a time, so no clutter cost). Revisit only
  if HTML size proves a problem.

## No-WebGL fallback

MapLibre requires WebGL; on GPU-less clients (including the primary dev machine)
the map never renders and the panel is the whole UI. There, each event card shows
the `FootprintSummary` **as text** (label + max MMI / radius + estimate caption).
The summary does double duty — audit record *and* textual overlay — so the
feature degrades to useful prose, never a blank.

## Never fail silently / politeness (CLAUDE.md #4, ADR 0008)

- Any footprint fetch/parse failure → `FootprintSource.forEvent` resolves
  `undefined`; the event shows no modeled zone (EQ falls back to the estimate
  ring), the run continues, no crash.
- No per-event degradation spam in the notices panel (a missing footprint is not
  a feed outage). The existing feed-level degradation notices are unchanged.
- Reuse the existing single-request + timeout + never-throw adapter pattern; no
  retry (consistent with the current ADR 0008 partial-deviation already recorded
  in implementation-notes).

## Named constants (thresholds.ts)

- `FELT_MMI_THRESHOLD` (default 3.5) — intensity defining the estimate ring edge.
- `FOOTPRINT_FETCH_TIMEOUT_MS` (default 30_000).
- `GEOMETRY_SIMPLIFY_TOLERANCE_DEG` (default 0.01) — RDP tolerance.
- MMI colour-ramp stops live with the render tokens (single source of truth,
  drift-guard tested like the existing tier colours).

## Testing (at the seam, no network/browser)

- `estimateFeltRadiusKm(mag, depthKm)` — pure; unit-tested against a hand-computed
  table, including deep-quake shrinkage and the no-magnitude case.
- `simplifyGeometry` (RDP) — pure; unit-tested (collinear points dropped,
  endpoints preserved, tolerance respected).
- `summariseShakeMap` / `summariseGdacsGeometry` — pure parsers over **recorded
  fixture payloads** (real ShakeMap + GDACS responses captured once); assert
  provenance, label, maxMmi/radius, and malformed-input safety (never throw).
- `fillFootprints` — driven through a fake `FootprintSource`; asserts summary
  attaches to the model, geometry lands in the side map keyed by composite id,
  and a failing source degrades to no-zone without throwing.
- Render test — embedded geometry round-trips; the "not an evacuation boundary"
  caption is always present; estimate zones carry `isEstimate` styling hooks.

## Out of scope (this slice)

- PAGER population numbers on the map (non-spatial; tiering already uses PAGER).
- Client-side live fetch of geometry (rejected: CORS/API-uptime at view time,
  and it would break the snapshot audit trail).
- Animating cyclone tracks or flood evolution over time.
- Historical footprint diffing / change detection on geometry.
- Estimate rings for non-EQ hazards (no defensible model).
- ReliefWeb zones (no coordinates).

## Open items pinned for the plan

1. Exact IPE coefficients + `FELT_MMI_THRESHOLD` calibration, with the locking
   unit-test table.
2. MMI colour ramp values (align to a recognised ShakeMap palette).
3. RDP tolerance tuned against real ShakeMap contour vertex counts to hit a
   sensible per-event embedded-size budget.
