# Footprint Geometry Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each surfaced event's impact-area geometry to Postgres (bitemporally) and feed it back to the Vercel dashboard so the map draws footprint polygons again.

**Architecture:** Add a nullable `footprint_geometry` jsonb column to `event_versions` (geometry travels with its version row). The ingestion write path attaches the `FeatureCollection` from `fillFootprints`' `geometryById`; a dedicated read path (`latestGeometryById`) reconstructs `geometryById` for the render route, keyed by `"${feed} ${feedEventId}"`. The deterministic core and `SurfacedEvent` are untouched.

**Tech Stack:** TypeScript (ESM, strict), Node 20; Drizzle ORM + `postgres` driver; Neon/local Postgres; Next.js App Router; Vitest.

## Global Constraints

- TypeScript on Node 20 LTS, ESM (`"type": "module"`), `strict: true`; import specifiers use `.js`.
- Deterministic core (`buildSitrep` and callees) makes no network/DB/LLM calls; geometry is an adapter concern (CLAUDE.md #1, #10).
- Never fail silently / never crash the page (CLAUDE.md #4): a geometry read failure degrades to no polygons, never a 503.
- `SurfacedEvent` and the pure mapping (`surfacedEventToRow`/`rowToSurfacedEvent`) stay geometry-free. Geometry is keyed by `footprintKey = "${feed} ${feedEventId}"` (`src/footprints/fill.ts`), matching the view-model card `key` and each feature's `eventId`.
- Geometry is already simplified at the source; store it verbatim.
- DB tests use a real Postgres via `DATABASE_URL`; no network/model/browser in tests. Local: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr"`.
- Governing ADR: 0011. Spec: `docs/superpowers/specs/2026-07-10-footprint-geometry-persistence-design.md`.

---

### Task 1: Schema column + migration

**Files:**
- Modify: `src/db/schema.ts` (add `footprintGeometry`)
- Create: `drizzle/0001_*.sql` (generated)

**Interfaces:**
- Produces: `event_versions.footprint_geometry` (nullable jsonb); `EventVersionRow` now has optional `footprintGeometry`.

- [ ] **Step 1: Add the column**

In `src/db/schema.ts`, inside the `eventVersions` column object, add after the `footprint` line (`footprint: jsonb("footprint"),`):
```ts
    footprintGeometry: jsonb("footprint_geometry"),
```
(`jsonb` is already imported.)

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new `drizzle/0001_*.sql` adding `ALTER TABLE "event_versions" ADD COLUMN "footprint_geometry" jsonb;`.

- [ ] **Step 3: Apply to local Postgres**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx drizzle-kit migrate`
Expected: migration applied. Verify: `docker exec hadr-pg psql -U postgres -d hadr -c "\d event_versions"` shows `footprint_geometry | jsonb`.

- [ ] **Step 4: Typecheck + commit**

Run: `npm run typecheck` (expect pass).
```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(db): add footprint_geometry column to event_versions"
```

---

### Task 2: Read path — latestGeometryById

**Files:**
- Modify: `src/db/reader.ts` (add `latestGeometryById`)
- Test: `test/db-integration.test.ts` (add cases)

**Interfaces:**
- Consumes: `getDb` (existing), `insertEventVersions` (existing), `surfacedEventToRow` (existing).
- Produces: `latestGeometryById(db): Promise<Record<string, FeatureCollection>>` — keyed by `"${feed} ${feedEventId}"`, only events with non-null geometry, newest version per event.

- [ ] **Step 1: Write the failing tests**

Add to `test/db-integration.test.ts` (add `import { latestGeometryById } from "../src/db/reader.js";` to the existing reader import line, and `import type { FeatureCollection } from "geojson";`):
```ts
const fc = (lon: number): FeatureCollection => ({
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, 2] },
    properties: { eventId: "USGS us1" },
  }],
});

describe("latestGeometryById", () => {
  it("returns geometry keyed by feed+id, newest version wins, null excluded", async () => {
    const db = await resetDb();
    // event with geometry, two versions — newest at 02:00
    await insertEventVersions(db, [{ ...surfacedEventToRow(ev(), new Date()), footprintGeometry: fc(1) }]);
    await insertEventVersions(db, [{
      ...surfacedEventToRow(ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 2, 0) }), new Date()),
      footprintGeometry: fc(9),
    }]);
    // a second event with no geometry
    await insertEventVersions(db, [surfacedEventToRow(ev({ feedEventId: "us2" }), new Date())]);

    const g = await latestGeometryById(db);
    expect(Object.keys(g)).toEqual(["USGS us1"]);           // us2 (null) excluded
    expect(g["USGS us1"].features[0].geometry).toEqual({ type: "Point", coordinates: [9, 2] }); // newest
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx vitest run db-integration`
Expected: FAIL — `latestGeometryById` is not exported.

- [ ] **Step 3: Implement the reader**

In `src/db/reader.ts`, add `import type { FeatureCollection } from "geojson";` at the top and append:
```ts
/** Newest footprint geometry per event, keyed by `${feed} ${feedEventId}` (the
 *  footprint key). Only events whose latest version has geometry appear. */
export async function latestGeometryById(db: Db): Promise<Record<string, FeatureCollection>> {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (feed, feed_event_id) feed, feed_event_id, footprint_geometry
    FROM event_versions
    WHERE footprint_geometry IS NOT NULL
    ORDER BY feed, feed_event_id, source_updated_at DESC
  `);
  const out: Record<string, FeatureCollection> = {};
  for (const r of rows as unknown as Record<string, unknown>[]) {
    out[`${r.feed as string} ${r.feed_event_id as string}`] = r.footprint_geometry as FeatureCollection;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx vitest run db-integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/reader.ts test/db-integration.test.ts
git commit -m "feat(db): latestGeometryById reader (newest footprint geometry per event)"
```

---

### Task 3: Write path — persistRun stores geometry

**Files:**
- Modify: `src/db/persist.ts` (signature + attach geometry)
- Modify: `src/run.ts` (pass `geometryById`)
- Test: `test/db-persist.test.ts` (add case)

**Interfaces:**
- Consumes: `footprintKey` (`src/footprints/fill.ts`), `latestGeometryById` (Task 2), `surfacedEventToRow`.
- Produces: `persistRun(db, assessed, feedResults, now, geometryById): Promise<{ inserted; dbWriteOk }>` — new final param `geometryById: Record<string, FeatureCollection>`.

- [ ] **Step 1: Write the failing test**

In `test/db-persist.test.ts`, add `import { latestGeometryById } from "../src/db/reader.js";` and `import type { FeatureCollection } from "geojson";`, then add inside the `describe`:
```ts
it("persists geometry from geometryById; events not in the map store null", async () => {
  const db = await resetDb();
  const fc: FeatureCollection = {
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: { eventId: "USGS us1" } }],
  };
  await persistRun(db, model([{
    feed: "USGS", feedEventId: "us1", hazardType: "EQ", title: "t", locationName: "l",
    coordinates: { lon: 1, lat: 2 }, time: Date.UTC(2026, 6, 9, 7, 0), metrics: { mag: 6 },
    tier: "HIGH", sourceUpdatedAt: Date.UTC(2026, 6, 9, 7, 30), updateProvenance: "source",
  }]), okFeeds, new Date(Date.UTC(2026, 6, 9, 8, 0)), { "USGS us1": fc });
  const g = await latestGeometryById(db);
  expect(g["USGS us1"]).toEqual(fc);
});
```
Also update the two existing `persistRun(...)` calls in this file to pass a final `{}` argument (empty geometry map).

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx vitest run db-persist`
Expected: FAIL — `persistRun` takes 4 args / geometry not stored.

- [ ] **Step 3: Update persistRun**

Rewrite `src/db/persist.ts` imports and signature. Add:
```ts
import type { FeatureCollection } from "geojson";
import { footprintKey } from "../footprints/fill.js";
```
Change the signature to add the final parameter and attach geometry when mapping rows:
```ts
export async function persistRun(
  db: Db, assessed: SitrepModel, feedResults: FeedResult[], now: Date,
  geometryById: Record<string, FeatureCollection>,
): Promise<{ inserted: number; dbWriteOk: boolean }> {
```
Inside the `try`, replace the `rows` line with:
```ts
    const rows = assessed.surfaced.map((e) => ({
      ...surfacedEventToRow(e, now),
      footprintGeometry: geometryById[footprintKey(e)] ?? null,
    }));
```
(The rest of `persistRun` — `insertEventVersions`, `recordIngestRun` success/failure — is unchanged.)

- [ ] **Step 4: Wire run.ts**

In `src/run.ts`, change the `persistRun` call (inside the `try` of the DB block) from:
```ts
      const { inserted } = await persistRun(getDb(), assessed, feedResults, now);
```
to:
```ts
      const { inserted } = await persistRun(getDb(), assessed, feedResults, now, geometryById);
```
(`geometryById` is already in scope from the earlier `const { model: withFootprints, geometryById } = await fillFootprints(...)`.)

- [ ] **Step 5: Run tests + typecheck**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx vitest run db-persist` (expect PASS).
Run: `npm run typecheck` (expect PASS — confirms `run.ts` passes the new arg).

- [ ] **Step 6: Commit**

```bash
git add src/db/persist.ts src/run.ts test/db-persist.test.ts
git commit -m "feat(db): persist footprint geometry in the ingestion dual-write"
```

---

### Task 4: App route renders persisted geometry

**Files:**
- Modify: `app/route.ts`

**Interfaces:**
- Consumes: `latestSurfacedEvents`, `latestGeometryById` (Task 2), `buildDbSitrepModel`, `renderDashboard`.

- [ ] **Step 1: Wire geometry into the render**

In `app/route.ts`, add `latestGeometryById` to the reader import:
```ts
import { latestSurfacedEvents, latestGeometryById } from "../src/db/reader.js";
```
Replace the body of the `try` (the events/model/html lines) with:
```ts
    const db = getDb();
    const [events, geometryById] = await Promise.all([
      latestSurfacedEvents(db),
      latestGeometryById(db).catch(() => ({})), // geometry is best-effort — no polygons beats a 503
    ]);
    const model = buildDbSitrepModel(events, new Date());
    const html = renderDashboard(model, geometryById);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Verify locally (seed geometry → route emits it)**

Reset + seed one row with geometry against local PG, then call the route handler and assert the embedded `sitrep-geometry` payload is non-empty:
```bash
DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx tsx -e "
import('./src/db/client.js').then(async ({getDb,closeDb})=>{
  const {sql}=await import('drizzle-orm');
  const {insertEventVersions}=await import('./src/db/writer.js');
  const {surfacedEventToRow}=await import('./src/db/mapping.js');
  await getDb().execute(sql\`TRUNCATE TABLE event_versions RESTART IDENTITY\`);
  const fc={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[120,15]},properties:{eventId:'USGS seedg'}}]};
  await insertEventVersions(getDb(),[{...surfacedEventToRow({feed:'USGS',feedEventId:'seedg',hazardType:'EQ',title:'M6 seed',locationName:'x',coordinates:{lon:120,lat:15},time:Date.now(),metrics:{mag:6},tier:'HIGH',sourceUpdatedAt:Date.now(),updateProvenance:'source'},new Date()),footprintGeometry:fc}]);
  const {GET}=await import('./app/route.ts');
  const r=await GET(); const b=await r.text();
  const m=b.match(/id=\"sitrep-geometry\"[^>]*>([^<]*)</);
  console.log('status',r.status,'geometry present:', !!(m && m[1] && m[1]!=='{}'));
  await closeDb();
});"
```
Expected: `status 200 geometry present: true`.

- [ ] **Step 4: Commit**

```bash
git add app/route.ts
git commit -m "feat(app): render persisted footprint geometry on the dashboard map"
```

---

### Task 5: Deploy, backfill Neon, docs

**Files:**
- Modify: `implementation-notes.md` (Deviations)

**Interfaces:** none (deploy + docs).

- [ ] **Step 1: Full suite + typecheck**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx vitest run` (expect all pass).
Run: `npm run typecheck` (expect pass).

- [ ] **Step 2: Apply the migration to Neon**

```bash
set -a; . ./.env.local; set +a
DATABASE_URL="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" npx drizzle-kit migrate
```
Expected: `0001_*` applied (adds `footprint_geometry`).

- [ ] **Step 3: Re-ingest against Neon to populate geometry**

```bash
set -a; . ./.env.local; set +a
DATABASE_URL="$DATABASE_URL" npx tsx src/run.ts
```
Expected: `db: wrote N new event version(s)` — the new rows carry geometry. (Discard the local `dashboard.html`/`data/` churn afterward: `git restore dashboard.html data/`.)

- [ ] **Step 4: Deploy**

Run: `npx vercel deploy` (preview/prod as before). After READY, smoke-test the public production domain:
```bash
curl -s https://hadr-starter.vercel.app/ -o /tmp/g.html
grep -oE '<script id="sitrep-geometry"[^>]*>[^<]*' /tmp/g.html | head -c 120
```
Expected: the `sitrep-geometry` payload is non-empty (contains `FeatureCollection`). Open the page: impact polygons draw; the "Impact areas" toggle and per-event selection work.

- [ ] **Step 5: Record the deviation**

In `implementation-notes.md` under Deviations, add:
```markdown
- **2026-07-10 — Footprint geometry persisted (Slice 1.5, ADR 0011).** Added a
  nullable `footprint_geometry` jsonb column to `event_versions`, versioned per
  source-update, storing the simplified GeoJSON FeatureCollection verbatim. A
  dedicated `latestGeometryById` reader feeds it back to the dashboard map (kept
  off `/api/events` and the core). Restores the impact-area polygons that Slice 1
  had dropped on the DB-backed app. PostGIS is the future path if spatial queries
  arrive (design doc §Decisions).
```

- [ ] **Step 6: Commit**

```bash
git add implementation-notes.md
git commit -m "docs: record footprint geometry persistence deviation (Slice 1.5)"
```

---

## Notes for the executor

- Local Docker Postgres `hadr-pg` must be running for Tasks 1–4 (`docker start hadr-pg`).
- `SurfacedEvent`, `buildSitrep`, and the pure mapping stay untouched — geometry never enters the event identity.
- Existing `event_versions` rows have `NULL` geometry until re-ingested (Step 3); this is expected and self-heals on the next run.
