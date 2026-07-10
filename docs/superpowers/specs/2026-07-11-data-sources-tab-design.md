# Data Sources tab — design

- **Date:** 2026-07-11
- **Status:** Approved (brainstorm), ready for implementation planning
- **Related:** ADR 0011 (hosted backend / Next.js app), ADR 0008 (feed degradation),
  `CLAUDE.md` (deterministic core seam; never overstate freshness), the shipped
  staleness UI (PR #15, `updatedRecency`).

## 1. Context & motivation

The dashboard is a single-page, map-first SPA (`src/render/dashboard.ts`) rendered
server-side as an HTML string from an embedded JSON view-model (`buildViewModel`,
`src/render/viewModel.ts`). An inlined, deliberately-dumb client script
(`src/render/client.ts`) builds the DOM from that JSON via `textContent` only —
all decisions live in the tested view-model.

Today the only per-source information on screen is the event panel's meta line:
`Generated <time> · feeds: USGS, GDACS, ReliefWeb`. There is no place that tells a
viewer **what** each feed is, **where** to read more, or **when we last got data
from it**. This feature adds a dedicated **Data Sources** tab that answers those
three questions, and removes the `feeds: …` fragment from the event panel.

The "last successful fetch" fact is already derivable from the existing
`ingest_runs` table — **no schema change is needed**.

## 2. Goals / non-goals

**Goals**
- A **Data Sources** panel listing the three feeds (USGS, GDACS, ReliefWeb), each
  with: name, a short description, a **homepage link + a smaller "feed ↗" endpoint
  link**, and a colour-coded **`Updated: ~x ago`** (last successful fetch age) with
  an at-a-glance **traffic-light dot**.
- Surface the **cron run time** ("Last fetch attempt") and a quiet note when a feed
  failed the latest run — without overstating unavailability (retained data is
  still useful).
- Remove `feeds: USGS, GDACS, ReliefWeb` from the event panel's meta line.

**Non-goals (YAGNI)**
- No schema/migration — derive from `ingest_runs`.
- No **per-feed** fetch timestamps. `ingest_runs.run_at` is shared by all feeds in a
  run, so "last successful fetch" means *the last run in which the feed was OK*
  (documented as a deviation, §9).
- No uptime history, sparklines, or fetch-latency charts.
- No new ADR — additive app feature within the ADR 0011 scope.

## 3. UX & navigation

Chosen layout: **rail button → dedicated panel** (mockup option A).

- A new right-rail button `#btn-sources` (icon `⛁`) opens `#sources-panel`, a
  slide-out occupying the **same slot** as the events `#panel` (right of the rail).
- The two panels are **mutually exclusive**: opening Data Sources closes Events and
  vice-versa. Implemented with two body classes, `panel-open` (events, the current
  default) and `sources-open` (sources); only one is set at a time.
- No routing; the app stays a single page.

### Panel contents

```
DATA SOURCES                         (h1, single-colour white)
Last fetch attempt: 2026-07-11 06:00 UTC   (subheader; = latest ingest_runs.run_at)
──────────────────────────────────────────
USGS                              ●  (traffic-light dot, right-aligned on name row)
Real-time global earthquakes — magnitude and PAGER impact alerts.
earthquake.usgs.gov ↗ · feed ↗
Updated: ~7m ago                     (colour-matched to the dot)
──────────────────────────────────────────
GDACS                             ●
Multi-hazard disaster alerts — earthquakes, cyclones, floods, volcanoes —
with colour-coded alert levels.
gdacs.org ↗ · feed ↗
Updated: ~7m ago
──────────────────────────────────────────
ReliefWeb                         ●  (orange)
UN OCHA humanitarian situation reports and disaster updates.
reliefweb.int ↗ · feed ↗
Updated: ~1d ago
⚠ Failed to fetch updates at 2026-07-11 06:00 UTC   (muted, not red)
```

### Two distinct times (must not be conflated)

- **`Updated: ~x ago`** (per feed) — age of the *freshest data we hold* from that
  feed = time since its **last successful** fetch.
- **`Last fetch attempt`** (panel subheader) — when the cron **last ran**, success
  or not = the latest `ingest_runs.run_at`.

### Colour bands (traffic-light dot + `Updated:` text, colour-matched)

Reuse the existing recency thresholds (`RECENCY_FRESH_MS`, `STALE_AFTER_MS` in
`src/thresholds.ts`), same bands as the event cards:

| Age since last successful fetch | Band | Colour var |
|---|---|---|
| `< 60m` (`RECENCY_FRESH_MS`) | fresh | `--fresh` `#22c55e` |
| `< 24h` (`STALE_AFTER_MS`) | recent | `--recent` `#fde047` |
| `≥ 24h` | stale | `--high` `#f59e0b` |

Accepted consequence: at the current **daily** cron cadence, healthy feeds sit at
yellow/orange for most of the day and only flash green right after a run; this
self-corrects when Slice 2 moves the cron to hourly.

### Failure & empty states (never overstate — `CLAUDE.md` #5)

- **Failed the latest run** (feed not in the latest run's `feeds_ok`): keep the
  age band from the last success, and add a **muted** (not red) line
  `⚠ Failed to fetch updates at <latest run time>`. The age stays truthful; the
  note is deliberately low-emphasis because prior-run data is still useful.
- **Never successfully fetched** (`lastFetchAt` is null): show `No successful fetch
  yet` (muted, no colour band / neutral dot).
- **Fetch status unavailable** (the reader threw — see §6): show
  `Fetch status unavailable` (muted, neutral dot). Distinct from "never fetched" so
  we never falsely claim a feed has no data just because the audit read failed.

### Header restyle (both panels)

Both panel headers become **single-colour white** — drop the accent `<span>` so the
title inherits one colour (`--text`). Applies to the new `DATA SOURCES` header **and**
the existing events header (`HADR MONITOR — Situation Report`, which currently
accent-colours the word "MONITOR").

## 4. Feed source registry (new: `src/feeds/sources.ts`)

A single constant array is the one tunable place for per-feed presentation
metadata (matches the "named constants in one place" convention).

```ts
export interface FeedSource {
  feed: FeedName;        // "USGS" | "GDACS" | "ReliefWeb"
  description: string;
  homeUrl: string;       // human homepage
  homeLabel: string;     // display text for the homepage link, e.g. "earthquake.usgs.gov"
  feedUrl: string;       // the machine endpoint we actually fetch
}

export const FEED_SOURCES: readonly FeedSource[] = [ /* USGS, GDACS, ReliefWeb */ ];
```

- `feedUrl` values are the **existing** endpoint constants; to keep one source of
  truth, **export** them from the adapters (`src/feeds/usgs.ts`, `gdacs.ts`,
  `reliefweb.ts`) and reference them here rather than duplicating the literals.
- Draft content (final wording reviewable):
  - **USGS** — `https://earthquake.usgs.gov` · "Real-time global earthquakes —
    magnitude and PAGER impact alerts."
  - **GDACS** — `https://www.gdacs.org` · "Multi-hazard disaster alerts —
    earthquakes, cyclones, floods, volcanoes — with colour-coded alert levels."
  - **ReliefWeb** — `https://reliefweb.int` · "UN OCHA humanitarian situation
    reports and disaster updates."
- The registry (fixed three feeds) also fixes **row order** in the panel.

## 5. Data derivation — new reader `lastFetchByFeed` (`src/db/reader.ts`)

Thin: returns raw DB facts (epoch-ms numbers + names), **no formatting, no registry
knowledge**. The view-model does the merging and formatting.

```ts
export interface FetchStatus {
  latestRunAt: number | null;              // newest ingest_runs.run_at (epoch ms), or null if no runs
  latestFeedsOk: string[];                 // feeds_ok of that newest run
  lastOkByFeed: Record<string, number>;    // feed -> epoch ms of its most recent OK run
}

export function lastFetchByFeed(db: Db): Promise<FetchStatus>;
```

Derivation (two reads):
1. **Latest run** — `SELECT run_at, feeds_ok FROM ingest_runs ORDER BY run_at DESC
   LIMIT 1` → `latestRunAt`, `latestFeedsOk`.
2. **Last OK per feed** — `SELECT f AS feed, MAX(run_at) AS last_ok FROM
   ingest_runs, unnest(feeds_ok) AS f GROUP BY f` → `lastOkByFeed`.

No rows → `latestRunAt = null`, `latestFeedsOk = []`, `lastOkByFeed = {}`.

## 6. View-model changes (`src/render/viewModel.ts`)

All formatting/derivation lives here (pure, unit-tested). The client stays dumb.

```ts
export interface DataSourceVM {
  feed: FeedName;
  description: string;
  homeUrl: string | null;          // sanitized http(s) only (defensive; values are our constants)
  homeLabel: string;
  feedUrl: string | null;          // sanitized http(s) only
  everFetched: boolean;
  updatedUtc: string | null;       // formatUtc(lastFetchAt), null if never
  updatedAgeLabel: string | null;  // ageLabel(now - lastFetchAt), null if never
  recency: "fresh" | "recent" | "stale" | null;  // null if never
  failureNote: string | null;      // "Failed to fetch updates at <utc>", else null
}
```

Additions to `DashboardVM`:
- `dataSources: DataSourceVM[]`
- `lastFetchAttemptUtc: string | null`   // `formatUtc(latestRunAt)`, null if no runs
- `dataSourcesStatusAvailable: boolean`  // false when the reader failed (fetchStatus === null)

Removals:
- Drop `feedsLine` from `DashboardVM` and stop emitting `feeds: …` in the meta line
  (the field is dead once the tab exists).

Signature:
```ts
buildViewModel(model: SitrepModel, fetchStatus: FetchStatus | null = null): DashboardVM
```
- "Now" for ages = `model.generatedAt` (consistent with the event cards).
- Per registry `FeedSource`, join with `fetchStatus`:
  - `lastFetchAt = fetchStatus.lastOkByFeed[feed] ?? null`.
  - `recency` / `updatedAgeLabel` / `updatedUtc` computed from `lastFetchAt`
    (reuse `recencyOf` / `ageLabel` / `formatUtc`); all null when `lastFetchAt` null.
  - `failureNote` set when `fetchStatus.latestRunAt !== null` **and** the feed is
    **not** in `fetchStatus.latestFeedsOk`: `"Failed to fetch updates at " +
    formatUtc(latestRunAt)`.
  - `homeUrl` / `feedUrl` sanitized with the existing http(s)-only guard used for
    event `sourceUrl`.
- `fetchStatus === null` → `dataSourcesStatusAvailable = false`,
  `lastFetchAttemptUtc = null`, and each row's fetch fields null (client renders
  "Fetch status unavailable").

## 7. Client changes (`src/render/client.ts`)

- **New `buildSources(vm)`** populates `#sources-list` and `#sources-sub`:
  - subheader: `vm.lastFetchAttemptUtc ? "Last fetch attempt: " +
    vm.lastFetchAttemptUtc : "No runs recorded yet"`.
  - each `vm.dataSources` row: `.nm` (name span + right-aligned `.light` dot whose
    class is the recency band or neutral), `.ds` description, `.links` (homepage
    `<a>` + `·` + `feed <a>` — a link is only rendered when its URL is non-null),
    `.ft` (`"Updated: " + updatedAgeLabel` with the recency class; or
    `No successful fetch yet` / `Fetch status unavailable` when null), and the muted
    `.failnote` (static `⚠` glyph + `failureNote` text) when present.
  - **`textContent` only** for all text; `href` set only from the sanitized VM URLs.
    The `⚠` glyph and separators are static markup, never feed-derived.
- **Panel toggling:** add `openSources()` / `openEvents()` helpers and wire:
  - `#btn-sources` → toggle `sources-open`, clear `panel-open`.
  - `#btn-events` → toggle `panel-open`, clear `sources-open`.
  - `#btn-status` → `openEvents()` (unchanged behaviour).
- **Meta line:** drop the `" · feeds: " + vm.feedsLine` segment; keep
  `Generated <time>` + optional changes summary.

## 8. Shell & CSS (`src/render/dashboard.ts`) and render call site

- **Rail:** add `<button id="btn-sources" title="Data sources" aria-label="Data
  sources">⛁</button>` after `#btn-status`.
- **Markup:** add `<aside id="sources-panel" aria-label="Data sources">` with
  `<h1>DATA SOURCES</h1>`, `<p id="sources-sub">`, `<div id="sources-list">`.
- **Header restyle:** remove the accent `<span>` from both `#panel h1`
  ("HADR MONITOR — Situation Report") and the new sources `h1`, so each is one
  colour (`--text`).
- **CSS:** `#sources-panel` mirrors `#panel` positioning; `body.sources-open
  #sources-panel { transform: translateX(0); }`. Add `.src`, `.src .nm` (flex, dot
  pushed right via `margin-left:auto`), `.light` (traffic-light dot; background per
  band), `.ds`, `.links`, and `.failnote` (muted). Reuse the existing
  `--fresh/--recent/--high` vars for the bands.
- **Signature:** `renderDashboard(model, geometryById = {}, fetchStatus:
  FetchStatus | null = null)`, forwarding `fetchStatus` to `buildViewModel`.
- **`app/route.ts`:** add `lastFetchByFeed(db).catch(() => null)` to the existing
  `Promise.all` (same best-effort pattern already used for `latestGeometryById`),
  and pass the result as the third `renderDashboard` argument. A failed status read
  therefore degrades to "Fetch status unavailable" rather than 503-ing the page.

## 9. Decisions & deviations (to record in `implementation-notes.md` at build time)

- **Run-level fetch time approximation.** `ingest_runs.run_at` is shared by every
  feed in a run, so `Updated:` reflects *the last run in which the feed was OK*, not
  a true per-feed fetch instant. Acceptable; true per-feed timestamps would need a
  schema change and are deferred.
- **Recency bands at daily cadence** read yellow/orange most of the day (user
  accepted); improves once Slice 2 makes the cron hourly.
- **`Updated:` wording is shared with the event cards** though the subject differs
  (there: upstream last revised the event; here: we last fetched the feed). Accepted
  for visual consistency — both answer "how fresh is this?".
- **`feeds: …` removed** from the event panel meta line (moved into the tab).

## 10. Testing (`npm test`, Vitest; no network / no browser)

- **`viewModel` unit tests** (pure):
  - `dataSources` follows registry order (USGS, GDACS, ReliefWeb).
  - Recency bands per age boundary (`<60m` fresh, `<24h` recent, `≥24h` stale),
    driven off the threshold constants.
  - `lastFetchAt` null → `updatedAgeLabel`/`updatedUtc`/`recency` all null
    (→ "No successful fetch yet").
  - Feed absent from `latestFeedsOk` while `latestRunAt` set → `failureNote`
    formatted with the run time; present in `latestFeedsOk` → `failureNote` null.
  - `fetchStatus === null` → `dataSourcesStatusAvailable=false`,
    `lastFetchAttemptUtc=null`.
  - `lastFetchAttemptUtc === formatUtc(latestRunAt)` when runs exist.
  - Meta view-model no longer carries `feedsLine`.
- **`lastFetchByFeed` integration test** (new `test/db-fetch-status.test.ts`),
  **gated with `describe.skipIf(!process.env.DATABASE_URL)`** (matching the DB
  suites): seed `ingest_runs` rows and assert `lastOkByFeed` picks the max `run_at`
  per feed among `feeds_ok`; `latestRunAt`/`latestFeedsOk` come from the newest run;
  a never-OK feed is absent from `lastOkByFeed`; no rows → nulls/empties.
- **No client/browser tests** — the client stays logic-free (exercised by the live
  run, per existing convention).

## 11. Files touched (summary)

| File | Change |
|---|---|
| `src/feeds/sources.ts` | **new** — `FeedSource` + `FEED_SOURCES` registry |
| `src/feeds/{usgs,gdacs,reliefweb}.ts` | export the fetch-endpoint URL constants |
| `src/db/reader.ts` | **new** `lastFetchByFeed` + `FetchStatus` type |
| `src/render/viewModel.ts` | `DataSourceVM`, `DashboardVM` additions, `buildViewModel` param, remove `feedsLine` |
| `src/render/dashboard.ts` | rail button, `#sources-panel` markup + CSS, monochrome headers, `renderDashboard` param |
| `src/render/client.ts` | `buildSources`, panel toggling, drop `feeds:` from meta |
| `app/route.ts` | best-effort `lastFetchByFeed` read, thread into `renderDashboard` |
| `test/viewModel.test.ts` | `dataSources` unit tests |
| `test/db-fetch-status.test.ts` | **new** gated reader integration tests |

## 12. Verification

- `npm test` green locally (DB suites skip without `DATABASE_URL`; run against the
  Docker Postgres to exercise the new reader test) and `npm run typecheck` clean.
- Drive the live app: open `/`, toggle the `⛁` rail button, confirm the panel, the
  two distinct times, the traffic-light dot + `Updated:` colour match, the "Both"
  links, and the muted failure note when a feed is down. Confirm the `feeds: …`
  fragment is gone from the event panel meta line.
