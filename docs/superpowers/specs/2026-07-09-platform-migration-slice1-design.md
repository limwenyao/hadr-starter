# Platform migration — Slice 1 design (DB → API → frontend, end-to-end)

- Date: 2026-07-09
- Status: Draft for review
- Governing ADR: 0011 (hosted backend, database, higher-fidelity ingestion)
- Approach: vertical slice, per ADR 0010

## Goal

Prove the re-platformed pipeline end-to-end on **one feed**: a Next.js app on Vercel
reads surfaced events from a hosted Postgres and renders the existing dashboard, while
the existing GitHub Actions ingestion writes **bitemporally versioned** rows to that
database. De-risks the two scariest unknowns — the source-time schema and the
DB→API→frontend wiring — before breadth (other feeds, hourly cadence, temporal UI,
export) is added.

Non-goal for this slice: the time-slider, trending, hourly cadence, GDACS/ReliefWeb
update-time extraction, and any export. Those are later slices (see Roadmap).

## Roadmap (context)

| Slice | Delivers |
|---|---|
| **1 (this spec)** | Next.js/Vercel + Neon + Drizzle; bitemporal schema; USGS ingestion writes versioned rows; dashboard renders latest state from DB; source-updated/staleness UI. |
| 2 | Hourly cadence; GDACS + ReliefWeb `source_updated_at` extraction. |
| 3 | Historical accumulation + retention/pruning. |
| 4 | Temporal UI (time-slider replay, trending) — introduces client-side fetch of time-windows. |
| 5 | Export: PDF (headless-Chrome backend) + GeoJSON. |

## Architecture

```
GitHub Actions cron (still daily this slice)
  └─ npm run sitrep → buildSitrep()        [pure core, UNCHANGED]
        ├─ writer → INSERT event_versions ON CONFLICT DO NOTHING → Neon Postgres
        └─ (transitional) also commit data/YYYY-MM-DD.json to git   [ADR 0006 audit net]

Next.js on Vercel
  app/page.tsx        (Server Component) ── reads latest state from Neon
        └─ buildViewModel(rows) → dashboard (MapLibre + slide-out panel, as today)
  app/api/events/route.ts  (JSON read endpoint; same query — for tests + later slices)
```

The deterministic core (`buildSitrep`, triage, duplicates, changes) is untouched. The
migration only adds I/O adapters around the seam: a DB **writer** on the ingestion side
and a DB **reader** on the render side. CLAUDE.md #1 and #10 preserved.

## Data model (bitemporal)

Two clocks are stored. Temporal features filter on **source time**; **system time** is
retained for audit and withdrawal inference only.

- Source time: `event_time` (occurrence) and `source_updated_at` (upstream last-modified).
- System time: `ingested_at` (when our run wrote the row).

```sql
event_versions (
  id                bigserial primary key,
  feed              text not null,          -- 'USGS' | 'GDACS' | 'ReliefWeb'
  feed_event_id     text not null,          -- (feed, feed_event_id) = core identity
  source_updated_at timestamptz not null,   -- UPSTREAM last-modified (temporal key)
  update_provenance text not null,          -- 'source' | 'inferred'
  event_time        timestamptz not null,   -- UPSTREAM occurrence time
  tier              text not null,
  title             text not null,
  location_name     text not null,
  lon               double precision,       -- null for ReliefWeb (list-only)
  lat               double precision,
  metrics           jsonb not null,         -- { mag, sig, pagerAlert, alertLevel }
  hazard_type       text not null,
  assessment        text,
  footprint         jsonb,                  -- FootprintSummary, nullable
  source_url        text,
  ingested_at       timestamptz not null,   -- system/audit axis only
  unique (feed, feed_event_id, source_updated_at)
);
-- indexes: (feed, feed_event_id, source_updated_at desc), (event_time), (source_updated_at)

ingest_runs (                               -- cheap operational audit (ADR 0008 over time)
  run_at          timestamptz primary key,
  feeds_ok        text[] not null,
  feeds_down      jsonb not null,           -- [{ feed, reason }]
  surfaced_count  integer not null,
  db_write_ok     boolean not null
);
```

**Write semantics.** Each run: `INSERT ... ON CONFLICT (feed, feed_event_id,
source_updated_at) DO NOTHING`. A new row appears only when the source presents a new
update stamp — a real upstream revision. Polling an unchanged event writes nothing, so
row count tracks *actual upstream updates*, not poll frequency. Late/out-of-order
upstream updates are handled naturally: the row is stamped with the source's time
(placing it correctly in history) while `ingested_at` records that we learned it late.

**Latest-state read** (this slice's only query):

```sql
SELECT DISTINCT ON (feed, feed_event_id) *
FROM event_versions
ORDER BY feed, feed_event_id, source_updated_at DESC;
```

Migrations are authored with Drizzle (`drizzle-kit`).

## Core change (adapter-level, behind the parse seam)

- Extend `Event` (src/types.ts) with `sourceUpdatedAt?: number` (epoch ms) and
  `updateProvenance?: "source" | "inferred"`.
- Teach the **USGS parser** to read `properties.updated`. GDACS/ReliefWeb are deferred
  to Slice 2; until then they fall back to `event_time` with `updateProvenance:
  "inferred"`. (This slice ingests USGS only, so the fallback is not yet exercised in
  practice but the contract is defined.)
- The writer maps `SurfacedEvent` → an `event_versions` row. Where `sourceUpdatedAt` is
  absent, it uses `event_time` and stamps `update_provenance = 'inferred'`.

`buildSitrep`'s run-to-run change detection is unchanged and still drives the daily
brief narrative; the DB's temporal truth is source-driven. (Deriving "revised" from
`source_updated_at` changes is a possible later simplification — not in scope.)

## Read path (Server Component)

- `app/page.tsx` is a React Server Component: it runs the latest-state query on Vercel,
  passes rows through `buildViewModel`, and renders the dashboard HTML server-side —
  the same server-rendered model as today, sourced from Neon instead of embedded JSON.
- `app/api/events/route.ts` exposes the same latest-state result as JSON, used by tests
  now and the temporal slider later. The page does not depend on it.
- The existing client script (map + panel) is reused, hydrated from the
  server-rendered payload.

## Staleness UI (duty-officer freshness judgement)

The officer decides whether data is stale; we present honest inputs, never a hard
verdict. Added to `EventCardVM` (all precomputed in the tested view-model):

- `sourceUpdatedUtc` — absolute, shown plainly (e.g. "Source updated 2026-07-09 14:03 UTC").
- `sourceUpdatedAgeLabel` — relative ("~2h ago"), computed from the injected render clock.
- `stalenessHint: boolean` — true only when age exceeds `STALE_AFTER_MS`, a named tunable
  constant in `src/thresholds.ts` (CLAUDE.md #3); renders a subtle "possibly stale" chip.
- `updateProvenance` — coarse feeds surface "publication time, approximate" so the
  officer knows a soft timeline is soft.

The card distinguishes the two clocks explicitly: **Occurred** … · **Source updated** …

## Error handling & degradation

- Feed-down handling unchanged (ADR 0008): `buildSitrep` degrades gracefully; the writer
  records `feeds_down` and `feeds_ok` in `ingest_runs`.
- **DB write failure** must not crash ingestion: log it, set `ingest_runs.db_write_ok =
  false`, exit non-zero for CI visibility; the last good DB state keeps serving the app.
  The transitional JSON snapshot is still committed, so no run is lost.
- **DB read failure** at render: the page shows a dismissible fallback banner (mirrors
  the existing no-WebGL banner) rather than a dead page — never fail silently.
- **Transitional dual-write:** dated JSON snapshots keep being committed (ADR 0006 audit
  trail) until the DB is trusted; dropped later by ADR.

## Testing

Tests never hit the network, call a model, or need a browser (CLAUDE.md test rule).

- **USGS parser extension:** fixture-driven unit tests for `sourceUpdatedAt` extraction
  from `properties.updated`, including the missing-field → `inferred` fallback.
- **Writer + latest-state query** (the risky new logic): tested against a real Postgres
  (ephemeral/local PG or a Neon branch in CI), asserting — re-ingesting an unchanged
  event adds no row; a new `source_updated_at` adds one; `DISTINCT ON` returns the newest
  version per event; late (earlier `source_updated_at`) inserts land in the right order.
- **View-model staleness fields:** pure unit tests with injected `now` — age labels and
  the `STALE_AFTER_MS` boundary.
- Existing `buildSitrep` tests remain green, untouched.

## Deviations / doc impact

- Supersessions recorded in ADR 0011 (0002/0005/0006 superseded; 0001 amended).
- CLAUDE.md's "tsx, no build step" convention must be updated for the Next.js build step
  (recorded in ADR 0011; update CLAUDE.md during implementation).
- Any departure discovered during build goes in `implementation-notes.md` under
  Deviations (deviations policy).

## Out of scope (this slice)

Hourly cadence; GDACS/ReliefWeb update-time extraction; time-slider/trending; retention/
pruning; export (PDF/GeoJSON); auth; dropping JSON snapshots.

## Open questions

- Exact CI Postgres strategy for the writer tests (ephemeral container vs Neon branch) —
  settle during planning.
- Whether the transitional JSON snapshot should be the full model or a trimmed audit
  record once the DB is primary — default: keep as-is for now.
