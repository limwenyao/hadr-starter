# Footprint Geometry Persistence — Slice 1.5 (ADR 0011)

- Status: Approved
- Date: 2026-07-10

## Problem

The Vercel/Neon dashboard (`app/route.ts`) renders the map with **no impact-area
polygons**: it calls `renderDashboard(model, {})`. The map's `impact-fill` /
`impact-line` layers are drawn only from `geometryById` (embedded as the
`sitrep-geometry` payload), and the DB read path has no geometry to supply.

Root cause: Slice 1 persists the footprint **summary** (`footprint` jsonb) but
drops the drawable **geometry** — the `Record<footprintKey, FeatureCollection>`
that `fillFootprints` produces during ingestion is never written to Postgres.
The old GitHub Pages dashboard draws polygons because `run.ts` passes that
geometry directly; the DB-backed app cannot.

This slice persists the geometry so the deployed map draws footprints again.

## Decisions (brainstormed 2026-07-10)

- **Versioned per source-update (bitemporal).** Geometry is tied to the same
  `(feed, feed_event_id, source_updated_at)` identity as the event row, so the
  planned time-slider (ADR 0011) can replay how footprints evolved.
- **Storage: a `jsonb` column on `event_versions`** (`footprint_geometry`),
  mirroring how the `footprint` summary is already stored. Chosen over a separate
  table (needless normalization at this scale) and over content-addressed dedup
  (hashing + orphan GC — YAGNI for a handful of small, pre-simplified polygons/day).
- **PostGIS deferred.** PostGIS is the right tool when geometry is *queried*
  server-side (intersection/distance/containment); the map does all spatial work
  client-side (MapLibre). A native `geometry` column also fits a `FeatureCollection`
  with per-feature `properties` (e.g. per-contour MMI) poorly — it would force a
  normalized per-feature table or lose properties. jsonb stores the client-ready
  GeoJSON verbatim. If a future slice needs spatial queries, migrate the jsonb into
  a PostGIS-backed per-feature table then, when the requirement is concrete.

## Global constraints

- Deterministic core (`buildSitrep` and callees) untouched — geometry is a
  persist/render adapter concern (CLAUDE.md #1, #10).
- Never fail silently / never crash the page (CLAUDE.md #4): a geometry read
  failure degrades to no polygons, it does not 503 the whole page.
- Geometry is already **simplified** at the source (`gdacs.ts`/`shakemap.ts` run
  `simplifyGeometry` before it reaches the pipeline), so stored payloads are small.
- `SurfacedEvent` stays geometry-free — geometry is keyed separately by
  `footprintKey = "${feed} ${feedEventId}"` (`src/footprints/fill.ts`), which
  already matches the view-model card `key` and the `eventId` stamped on every
  feature. No client change is required.

## Architecture

### Schema (`src/db/schema.ts`)
Add one nullable column to `event_versions`:
```ts
footprintGeometry: jsonb("footprint_geometry"),  // GeoJSON FeatureCollection | null
```
Regenerate the Drizzle migration; apply to local Docker Postgres and to Neon.

### Write path
- `persistRun(db, assessed, feedResults, now, geometryById)` — new final
  parameter. `run.ts` already holds `geometryById` from `fillFootprints`.
- The pure mapping (`surfacedEventToRow`) is unchanged. `persistRun` attaches
  geometry when building each row:
  ```ts
  { ...surfacedEventToRow(e, now), footprintGeometry: geometryById[footprintKey(e)] ?? null }
  ```
- `run.ts` passes `geometryById` (the value from
  `fillFootprints(model, httpFootprintSource)`).

### Read path (`src/db/reader.ts`)
New dedicated reader so the blob never bloats `/api/events` or `buildSitrep`:
```ts
latestGeometryById(db): Promise<Record<string, FeatureCollection>>
```
```sql
SELECT DISTINCT ON (feed, feed_event_id) feed, feed_event_id, footprint_geometry
FROM event_versions
WHERE footprint_geometry IS NOT NULL
ORDER BY feed, feed_event_id, source_updated_at DESC
```
Return a record keyed by `` `${feed} ${feed_event_id}` `` → the parsed
FeatureCollection. `DISTINCT ON ... ORDER BY source_updated_at DESC` mirrors
`latestSurfacedEvents`, so geometry aligns with the latest event version.

### App route (`app/route.ts`)
Read events and geometry in parallel; geometry is best-effort:
```ts
const db = getDb();
const [events, geometryById] = await Promise.all([
  latestSurfacedEvents(db),
  latestGeometryById(db).catch(() => ({})),  // degrade to no polygons, never 503
]);
const model = buildDbSitrepModel(events, new Date());
const html = renderDashboard(model, geometryById);
```
The existing outer try/catch still returns the 503 fallback if the essential
events read fails.

## Data flow

```
ingest: feeds → buildSitrep → fillFootprints ──► model (+footprint summary)
                                              └─► geometryById
        persistRun(model, …, geometryById) ──► event_versions rows
                                               (footprint jsonb + footprint_geometry jsonb)

render: GET / → latestSurfacedEvents ─┐
               latestGeometryById  ───┴─► renderDashboard(model, geometryById)
                                          → sitrep-data + sitrep-geometry → client map
```

## Error handling

- Geometry read throws → caught, degrade to `{}` (map shows pins/summaries, no
  polygons). Logged server-side.
- Geometry write: geometry is set inside the same insert as the event row, so it
  shares `persistRun`'s existing failure path (records `db_write_ok=false`, run
  exits non-zero, snapshot still committed).
- Malformed stored geometry: the client already guards
  (`try { JSON.parse(...) } catch { geometry = {} }`).

## Backfill

Existing `event_versions` rows have `footprint_geometry = NULL`; geometry is only
obtainable by re-fetching feeds. After deploy, run **one manual ingestion against
Neon** to repopulate the current events. No historical backfill (feeds do not
expose past geometry). Until re-ingested, current rows draw no polygons — an
acceptable, self-healing gap.

## Testing

Tests never hit the network, call a model, or need a browser (CLAUDE.md).

- **`test/db-integration.test.ts`** (real Postgres):
  - A row with `footprintGeometry` round-trips; `latestGeometryById` returns it
    keyed by `` `${feed} ${feedEventId}` ``.
  - Rows with `NULL` geometry are excluded from the result.
  - When an event revises, `latestGeometryById` returns the **newest** version's
    geometry.
- **`test/db-persist.test.ts`** (real Postgres): `persistRun` with a non-empty
  `geometryById` writes `footprint_geometry`; an event absent from `geometryById`
  stores `NULL`.
- **View-model / `SurfacedEvent` mapping tests**: unchanged (geometry is not part
  of `SurfacedEvent`).
- Client map JS: unit-untested per existing convention; verified by a live render
  against Neon after deploy (impact polygons appear; the "Impact areas" toggle
  and per-event selection filter work).

## Out of scope

Client rendering changes; spatial queries / PostGIS; geometry retention/pruning;
exposing geometry on `/api/events`; historical backfill.

## Deviations / doc impact

- Extends the ADR 0011 / Slice 1 `event_versions` schema (records in
  `implementation-notes.md` under Deviations). One nullable additive column — no
  alter-migration debt beyond the new migration file.
- PostGIS noted as the future path for spatial querying.
