# Data Sources Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Data Sources" rail panel listing USGS/GDACS/ReliefWeb with a description, homepage + feed links, and a colour-coded "Updated: ~x ago" (last successful fetch) — derived from the existing `ingest_runs` table.

**Architecture:** A new thin DB reader derives per-feed last-successful-fetch facts from `ingest_runs`; the pure, unit-tested view-model turns those facts (joined with a static feed registry) into a render-ready `dataSources` array; the dumb client script builds the panel DOM from it. No schema change, no new ADR.

**Tech Stack:** TypeScript (ESM, `strict`), Next.js App Router (`app/route.ts`), Drizzle + postgres-js (Neon/Postgres), Vitest. Core/scripts run under tsx.

## Global Constraints

- **ESM import extensions:** every relative import ends in `.js` even when the source is `.ts` (e.g. `import { FEED_SOURCES } from "../feeds/sources.js"`).
- **Tests never hit the network, a real model, or a browser.** DB integration suites are gated with `describe.skipIf(!process.env.DATABASE_URL)` (matches `test/db-integration.test.ts`).
- **The client script (`src/render/client.ts`) is a `String.raw` template:** no backticks and no `${` inside it. Render all data via `textContent` only (never `innerHTML`); set `href` only from view-model URLs already sanitized to http(s).
- **Recency bands come from `src/thresholds.ts`** (`RECENCY_FRESH_MS`, `STALE_AFTER_MS`) via the existing `recencyOf` helper — never inline the numbers.
- **Domain vocabulary:** "feed", "surfaced event", "priority tier". A feed's "last successful fetch" ≠ an event's `source_updated_at`.
- **Deviations policy:** record any departure from the spec/ADRs/CLAUDE.md in `implementation-notes.md` under **Deviations** (see Task 1, Step 6).

---

### Task 1: DB reader `lastFetchByFeed` + `FetchStatus` type

Derives, from `ingest_runs`, each feed's most recent successful-fetch time and the latest run's status. Thin: returns epoch-ms numbers + names only.

**Files:**
- Modify: `src/types.ts` (add `FetchStatus`)
- Modify: `src/db/reader.ts` (add `lastFetchByFeed`)
- Test: `test/db-fetch-status.test.ts` (create)
- Modify: `implementation-notes.md` (record deviation, Step 6)

**Interfaces:**
- Consumes: `ingestRuns` schema (`run_at timestamptz`, `feeds_ok text[]`); `recordIngestRun(db, IngestRunRow)` from `src/db/writer.js` (test seeding).
- Produces:
  - `interface FetchStatus { latestRunAt: number | null; latestFeedsOk: string[]; lastOkByFeed: Record<string, number>; }`
  - `lastFetchByFeed(db: Db): Promise<FetchStatus>`

- [ ] **Step 1: Add the `FetchStatus` type**

In `src/types.ts`, append:

```ts
/**
 * Per-feed fetch health derived from ingest_runs (Data Sources tab). run_at is
 * shared by all feeds in a run, so "last successful fetch" means the last run in
 * which the feed was in feeds_ok — not a per-feed fetch instant (see deviation).
 */
export interface FetchStatus {
  /** Epoch ms of the newest ingest run, or null when no runs recorded. */
  latestRunAt: number | null;
  /** feeds_ok of that newest run. */
  latestFeedsOk: string[];
  /** feed -> epoch ms of its most recent successful (feeds_ok) run. */
  lastOkByFeed: Record<string, number>;
}
```

- [ ] **Step 2: Write the failing test**

Create `test/db-fetch-status.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resetDb, closeDb } from "./helpers/db.js";
import { recordIngestRun } from "../src/db/writer.js";
import { lastFetchByFeed } from "../src/db/reader.js";

const run = (
  runAt: Date,
  feedsOk: string[],
  feedsDown: { feed: string; reason: string }[] = [],
) => ({ runAt, feedsOk, feedsDown, surfacedCount: 0, dbWriteOk: true });

describe.skipIf(!process.env.DATABASE_URL)("lastFetchByFeed", () => {
  beforeAll(async () => { await resetDb(); });
  afterEach(async () => { await resetDb(); });
  afterAll(async () => { await closeDb(); });

  it("no runs -> nulls and empties", async () => {
    const db = await resetDb();
    expect(await lastFetchByFeed(db)).toEqual({
      latestRunAt: null, latestFeedsOk: [], lastOkByFeed: {},
    });
  });

  it("last OK per feed = max run_at in feeds_ok; latest run drives latestRunAt/latestFeedsOk", async () => {
    const db = await resetDb();
    const t1 = Date.UTC(2026, 6, 10, 6, 0);
    const t2 = Date.UTC(2026, 6, 11, 6, 0);
    await recordIngestRun(db, run(new Date(t1), ["USGS", "GDACS", "ReliefWeb"]));
    await recordIngestRun(db, run(new Date(t2), ["USGS", "GDACS"], [{ feed: "ReliefWeb", reason: "timeout" }]));
    const s = await lastFetchByFeed(db);
    expect(s.latestRunAt).toBe(t2);
    expect([...s.latestFeedsOk].sort()).toEqual(["GDACS", "USGS"]);
    expect(s.lastOkByFeed).toEqual({ USGS: t2, GDACS: t2, ReliefWeb: t1 });
  });

  it("a feed that never succeeded is absent from lastOkByFeed", async () => {
    const db = await resetDb();
    const t = Date.UTC(2026, 6, 11, 6, 0);
    await recordIngestRun(db, run(new Date(t), ["USGS"],
      [{ feed: "GDACS", reason: "500" }, { feed: "ReliefWeb", reason: "500" }]));
    const s = await lastFetchByFeed(db);
    expect(s.lastOkByFeed).toEqual({ USGS: t });
    expect(s.latestFeedsOk).toEqual(["USGS"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `DATABASE_URL=postgres://postgres:hadr@localhost:5432/hadr npx vitest run test/db-fetch-status.test.ts`
(Start the local DB first if needed: `docker start hadr-pg`.)
Expected: FAIL — `lastFetchByFeed` is not exported from `reader.js`.

- [ ] **Step 4: Implement `lastFetchByFeed`**

In `src/db/reader.ts`, add the import of the type and the function. Add `FetchStatus` to the existing type import from `../types.js`:

```ts
import type { SurfacedEvent, FetchStatus } from "../types.js";
```

Append the reader (`sql` and `Db` are already in scope in this file):

```ts
/**
 * Per-feed last-successful-fetch facts for the Data Sources tab, derived from
 * ingest_runs. Thin: epoch-ms numbers + names only; the view-model formats.
 */
export async function lastFetchByFeed(db: Db): Promise<FetchStatus> {
  const latest = await db.execute(sql`
    SELECT run_at, feeds_ok FROM ingest_runs ORDER BY run_at DESC LIMIT 1
  `);
  const latestRow = (latest as unknown as Record<string, unknown>[])[0];

  const perFeed = await db.execute(sql`
    SELECT f AS feed, MAX(run_at) AS last_ok
    FROM ingest_runs, unnest(feeds_ok) AS f
    GROUP BY f
  `);
  const lastOkByFeed: Record<string, number> = {};
  for (const r of perFeed as unknown as Record<string, unknown>[]) {
    lastOkByFeed[r.feed as string] = new Date(r.last_ok as string | Date).getTime();
  }

  return {
    latestRunAt: latestRow ? new Date(latestRow.run_at as string | Date).getTime() : null,
    latestFeedsOk: latestRow ? (latestRow.feeds_ok as string[]) : [],
    lastOkByFeed,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `DATABASE_URL=postgres://postgres:hadr@localhost:5432/hadr npx vitest run test/db-fetch-status.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Record the deviation**

In `implementation-notes.md`, under **Deviations**, add:

```markdown
- **2026-07-11 — "Last successful fetch" is run-level, not per-feed (Data Sources
  tab).** `ingest_runs.run_at` is shared by all feeds in a run, so `lastFetchByFeed`
  reports the last run in which a feed was in `feeds_ok`, not a true per-feed fetch
  instant. True per-feed timestamps would need a schema change; deferred. Accurate
  enough for the tab's "Updated: ~x ago".
```

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/db/reader.ts test/db-fetch-status.test.ts implementation-notes.md
git commit -m "feat(db): lastFetchByFeed reader over ingest_runs"
```

---

### Task 2: Feed source registry + adapter URL exports

The single tunable place for per-feed presentation metadata. Reuses the adapters' existing endpoint URLs as the one source of truth.

**Files:**
- Modify: `src/feeds/usgs.ts` (export `USGS_ALL_DAY_URL`)
- Modify: `src/feeds/gdacs.ts` (export `GDACS_EVENTS_URL`)
- Modify: `src/feeds/reliefweb.ts` (export `RELIEFWEB_RSS_URL`)
- Create: `src/feeds/sources.ts`
- Test: `test/sources.test.ts` (create)

**Interfaces:**
- Consumes: `FeedName` from `../types.js`; the three endpoint URL constants.
- Produces:
  - `interface FeedSource { feed: FeedName; description: string; homeUrl: string; homeLabel: string; feedUrl: string; }`
  - `export const FEED_SOURCES: readonly FeedSource[]` (order: USGS, GDACS, ReliefWeb)

- [ ] **Step 1: Export the endpoint URL constants**

Add the `export` keyword to each declaration (do not change the values):
- `src/feeds/usgs.ts:86` → `export const USGS_ALL_DAY_URL =`
- `src/feeds/gdacs.ts:98` → `export const GDACS_EVENTS_URL =`
- `src/feeds/reliefweb.ts:23` → `export const RELIEFWEB_RSS_URL = "https://reliefweb.int/disasters/rss.xml";`

- [ ] **Step 2: Write the failing test**

Create `test/sources.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FEED_SOURCES } from "../src/feeds/sources.js";

describe("FEED_SOURCES registry", () => {
  it("covers the three feeds in display order with complete fields", () => {
    expect(FEED_SOURCES.map((s) => s.feed)).toEqual(["USGS", "GDACS", "ReliefWeb"]);
    for (const s of FEED_SOURCES) {
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.homeLabel.length).toBeGreaterThan(0);
      expect(s.homeUrl).toMatch(/^https:\/\//);
      expect(s.feedUrl).toMatch(/^https:\/\//);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/sources.test.ts`
Expected: FAIL — cannot resolve `../src/feeds/sources.js`.

- [ ] **Step 4: Create the registry**

Create `src/feeds/sources.ts`:

```ts
import type { FeedName } from "../types.js";
import { USGS_ALL_DAY_URL } from "./usgs.js";
import { GDACS_EVENTS_URL } from "./gdacs.js";
import { RELIEFWEB_RSS_URL } from "./reliefweb.js";

/** Presentation metadata for the Data Sources tab. Single tunable place. */
export interface FeedSource {
  feed: FeedName;
  description: string;
  /** Human homepage to link to. */
  homeUrl: string;
  /** Display text for the homepage link. */
  homeLabel: string;
  /** The machine endpoint we actually fetch (reused from the adapter). */
  feedUrl: string;
}

export const FEED_SOURCES: readonly FeedSource[] = [
  {
    feed: "USGS",
    description: "Real-time global earthquakes — magnitude and PAGER impact alerts.",
    homeUrl: "https://earthquake.usgs.gov",
    homeLabel: "earthquake.usgs.gov",
    feedUrl: USGS_ALL_DAY_URL,
  },
  {
    feed: "GDACS",
    description:
      "Multi-hazard disaster alerts — earthquakes, cyclones, floods, volcanoes — with colour-coded alert levels.",
    homeUrl: "https://www.gdacs.org",
    homeLabel: "gdacs.org",
    feedUrl: GDACS_EVENTS_URL,
  },
  {
    feed: "ReliefWeb",
    description: "UN OCHA humanitarian situation reports and disaster updates.",
    homeUrl: "https://reliefweb.int",
    homeLabel: "reliefweb.int",
    feedUrl: RELIEFWEB_RSS_URL,
  },
];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/sources.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/feeds/usgs.ts src/feeds/gdacs.ts src/feeds/reliefweb.ts src/feeds/sources.ts test/sources.test.ts
git commit -m "feat(feeds): FEED_SOURCES registry for the Data Sources tab"
```

---

### Task 3: View-model `dataSources` (pure render logic)

Joins the registry with `FetchStatus` and formats every string the panel needs. This is where all Data Sources decisions live; the client stays dumb.

**Files:**
- Modify: `src/render/viewModel.ts`
- Test: `test/view-model.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `FEED_SOURCES` (Task 2); `FetchStatus` (Task 1); existing `formatUtc`, `ageLabel`, `recencyOf`.
- Produces (added to `DashboardVM`):
  - `dataSources: DataSourceVM[]`
  - `lastFetchAttemptUtc: string | null`
  - `dataSourcesStatusAvailable: boolean`
  - `interface DataSourceVM { feed: FeedName; description: string; homeUrl: string | null; homeLabel: string; feedUrl: string | null; everFetched: boolean; updatedUtc: string | null; updatedAgeLabel: string | null; recency: "fresh" | "recent" | "stale" | null; failureNote: string | null; }`
  - `buildViewModel(model, fetchStatus?: FetchStatus | null): DashboardVM`

- [ ] **Step 1: Write the failing tests**

Append to `test/view-model.test.ts` (the `model`/`surfaced` factories already exist at the top of the file):

```ts
import type { FetchStatus } from "../src/types.js";

const GEN = Date.UTC(2026, 6, 8, 0, 30); // matches model() generatedAt

function fetchStatus(over: Partial<FetchStatus> = {}): FetchStatus {
  return { latestRunAt: GEN, latestFeedsOk: ["USGS", "GDACS", "ReliefWeb"], lastOkByFeed: {}, ...over };
}

describe("buildViewModel — data sources", () => {
  it("lists the three feeds in registry order", () => {
    const vm = buildViewModel(model({}), fetchStatus());
    expect(vm.dataSources.map((s) => s.feed)).toEqual(["USGS", "GDACS", "ReliefWeb"]);
  });

  it("bands the last-successful-fetch age: fresh <60m, recent <24h, stale >=24h", () => {
    const vm = buildViewModel(model({}), fetchStatus({
      lastOkByFeed: {
        USGS: GEN - 10 * 60_000,        // 10m -> fresh
        GDACS: GEN - 5 * 60 * 60_000,   // 5h  -> recent
        ReliefWeb: GEN - 30 * 60 * 60_000, // 30h -> stale
      },
    }));
    const [u, g, r] = vm.dataSources;
    expect([u.recency, g.recency, r.recency]).toEqual(["fresh", "recent", "stale"]);
    expect(u.updatedAgeLabel).toBe("~10m ago");
    expect(r.updatedAgeLabel).toBe("~1d ago");
  });

  it("never-fetched feed -> null age/recency, everFetched false", () => {
    const vm = buildViewModel(model({}), fetchStatus({ lastOkByFeed: { USGS: GEN } }));
    const g = vm.dataSources.find((s) => s.feed === "GDACS")!;
    expect(g.everFetched).toBe(false);
    expect(g.updatedAgeLabel).toBeNull();
    expect(g.recency).toBeNull();
    expect(g.updatedUtc).toBeNull();
  });

  it("failed-latest-run feed gets a failure note with the run time; ok feeds do not", () => {
    const vm = buildViewModel(model({}), fetchStatus({
      latestFeedsOk: ["USGS", "GDACS"],
      lastOkByFeed: { USGS: GEN, GDACS: GEN, ReliefWeb: GEN - 24 * 60 * 60_000 },
    }));
    const r = vm.dataSources.find((s) => s.feed === "ReliefWeb")!;
    const u = vm.dataSources.find((s) => s.feed === "USGS")!;
    expect(r.failureNote).toBe("Failed to fetch updates at 2026-07-08T00:30:00.000Z");
    expect(u.failureNote).toBeNull();
  });

  it("exposes the latest run time as lastFetchAttemptUtc", () => {
    const vm = buildViewModel(model({}), fetchStatus({ latestRunAt: Date.UTC(2026, 6, 8, 6, 0) }));
    expect(vm.lastFetchAttemptUtc).toBe("2026-07-08T06:00:00.000Z");
    expect(vm.dataSourcesStatusAvailable).toBe(true);
  });

  it("null fetch status -> status unavailable, no attempt time, null recency", () => {
    const vm = buildViewModel(model({}), null);
    expect(vm.dataSourcesStatusAvailable).toBe(false);
    expect(vm.lastFetchAttemptUtc).toBeNull();
    expect(vm.dataSources).toHaveLength(3);
    expect(vm.dataSources.every((s) => s.recency === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/view-model.test.ts`
Expected: FAIL — `buildViewModel` takes one arg / `dataSources` undefined.

- [ ] **Step 3: Implement the view-model additions**

In `src/render/viewModel.ts`:

(a) Add imports near the top (after the existing imports):

```ts
import { FEED_SOURCES } from "../feeds/sources.js";
import type { FetchStatus } from "../types.js";
```

Also add `FeedName` to the existing `../types.js` import if not already present (it is imported already in this file).

(b) Add the `DataSourceVM` interface (next to `EventCardVM`):

```ts
export interface DataSourceVM {
  feed: FeedName;
  description: string;
  /** Sanitized http(s) only, else null. */
  homeUrl: string | null;
  homeLabel: string;
  /** Sanitized http(s) only, else null. */
  feedUrl: string | null;
  everFetched: boolean;
  /** Formatted UTC of the last successful fetch, or null if never. */
  updatedUtc: string | null;
  /** Relative age of the last successful fetch, e.g. "~7m ago", or null. */
  updatedAgeLabel: string | null;
  /** Recency band of the fetch age, or null if never fetched. */
  recency: "fresh" | "recent" | "stale" | null;
  /** "Failed to fetch updates at <utc>" when the latest run failed, else null. */
  failureNote: string | null;
}
```

(c) Add the three fields to the `DashboardVM` interface:

```ts
  /** Feed source rows for the Data Sources tab. */
  dataSources: DataSourceVM[];
  /** When the cron last ran (latest ingest run), formatted UTC, or null. */
  lastFetchAttemptUtc: string | null;
  /** False when the fetch-status read failed (client shows "unavailable"). */
  dataSourcesStatusAvailable: boolean;
```

(d) Add a URL guard + a builder (place above `buildViewModel`):

```ts
/** http(s)-only guard (mirrors the event sourceUrl sanitization). */
function httpUrl(url: string | null | undefined): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function buildDataSources(fetchStatus: FetchStatus | null, now: number): DataSourceVM[] {
  return FEED_SOURCES.map((s) => {
    const lastFetchAt = fetchStatus ? fetchStatus.lastOkByFeed[s.feed] ?? null : null;
    const failed =
      fetchStatus != null &&
      fetchStatus.latestRunAt != null &&
      !fetchStatus.latestFeedsOk.includes(s.feed);
    return {
      feed: s.feed,
      description: s.description,
      homeUrl: httpUrl(s.homeUrl),
      homeLabel: s.homeLabel,
      feedUrl: httpUrl(s.feedUrl),
      everFetched: lastFetchAt != null,
      updatedUtc: lastFetchAt != null ? formatUtc(lastFetchAt) : null,
      updatedAgeLabel: lastFetchAt != null ? ageLabel(now - lastFetchAt) : null,
      recency: lastFetchAt != null ? recencyOf(now - lastFetchAt) : null,
      failureNote:
        failed && fetchStatus!.latestRunAt != null
          ? "Failed to fetch updates at " + formatUtc(fetchStatus!.latestRunAt)
          : null,
    };
  });
}
```

(e) Change the `buildViewModel` signature and return object:

```ts
export function buildViewModel(
  model: SitrepModel,
  fetchStatus: FetchStatus | null = null,
): DashboardVM {
```

Add these three properties to the returned object (leave `feedsLine` in place for now — it is removed in Task 5):

```ts
    dataSources: buildDataSources(fetchStatus, model.generatedAt),
    lastFetchAttemptUtc:
      fetchStatus && fetchStatus.latestRunAt != null ? formatUtc(fetchStatus.latestRunAt) : null,
    dataSourcesStatusAvailable: fetchStatus != null,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/view-model.test.ts`
Expected: PASS (existing tests + the 6 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/render/viewModel.ts test/view-model.test.ts
git commit -m "feat(render): dataSources view-model for the Data Sources tab"
```

---

### Task 4: Dashboard shell — rail button, sources panel, CSS, monochrome headers

Adds the static markup + styling and threads `fetchStatus` through `renderDashboard`. Verified by a server-side render smoke test (no browser).

**Files:**
- Modify: `src/render/dashboard.ts`
- Test: `test/render.test.ts` (append)

**Interfaces:**
- Consumes: `buildViewModel(model, fetchStatus)` (Task 3); `FetchStatus` (Task 1).
- Produces: `renderDashboard(model, geometryById?, fetchStatus?: FetchStatus | null)`; DOM ids `btn-sources`, `sources-panel`, `sources-sub`, `sources-list`; body class `sources-open`; CSS classes `.src`, `.src .nm`, `.light`, `.ds`, `.links`, `.updated`, `.failnote` (reuse `.recency-fresh/recent/stale`).

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.ts`:

```ts
import type { FetchStatus } from "../src/types.js";

describe("renderDashboard — Data Sources tab", () => {
  const status: FetchStatus = {
    latestRunAt: Date.UTC(2026, 6, 8, 0, 0),
    latestFeedsOk: ["USGS", "GDACS", "ReliefWeb"],
    lastOkByFeed: {
      USGS: Date.UTC(2026, 6, 8, 0, 0),
      GDACS: Date.UTC(2026, 6, 8, 0, 0),
      ReliefWeb: Date.UTC(2026, 6, 7, 0, 0),
    },
  };

  it("renders the rail button and sources panel scaffold", () => {
    const html = renderDashboard(model({}), {}, status);
    expect(html).toContain('id="btn-sources"');
    expect(html).toContain('id="sources-panel"');
    expect(html).toContain('id="sources-list"');
    expect(html).toContain(">DATA SOURCES<");
  });

  it("embeds the dataSources payload and attempt time", () => {
    const html = renderDashboard(model({}), {}, status);
    const payload = extractPayload(html) as {
      dataSources: { feed: string }[];
      lastFetchAttemptUtc: string;
      dataSourcesStatusAvailable: boolean;
    };
    expect(payload.dataSources.map((s) => s.feed)).toEqual(["USGS", "GDACS", "ReliefWeb"]);
    expect(payload.lastFetchAttemptUtc).toBe("2026-07-08T00:00:00.000Z");
    expect(payload.dataSourcesStatusAvailable).toBe(true);
  });

  it("event panel header is single-colour (no accent span)", () => {
    const html = renderDashboard(model({}), {}, status);
    expect(html).toContain("<h1>HADR MONITOR — Situation Report</h1>");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL — no `btn-sources` / accent span still present / `renderDashboard` ignores third arg.

- [ ] **Step 3: Change the `renderDashboard` signature**

In `src/render/dashboard.ts`, update the function signature and the `buildViewModel` call:

```ts
export function renderDashboard(
  model: SitrepModel,
  geometryById: Record<string, FeatureCollection> = {},
  fetchStatus: FetchStatus | null = null,
): string {
```

Change `const payload = JSON.stringify(buildViewModel(model))...` to:

```ts
  const payload = JSON.stringify(buildViewModel(model, fetchStatus)).replace(/</g, "\\u003c");
```

Add the type import at the top of the file:

```ts
import type { FetchStatus } from "../types.js";
```

- [ ] **Step 4: Make the events header single-colour**

Change the events panel `<h1>` (currently `<h1>HADR <span>MONITOR</span> — Situation Report</h1>`) to:

```html
    <h1>HADR MONITOR — Situation Report</h1>
```

- [ ] **Step 5: Add the rail button**

Immediately after the `#btn-status` button in the `<nav id="rail">` block, add:

```html
  <button id="btn-sources" title="Data sources" aria-label="Data sources">⛁</button>
```

- [ ] **Step 6: Add the sources panel markup**

Immediately after the events `</aside>` (the `#panel` aside), add:

```html
<aside id="sources-panel" aria-label="Data sources">
  <header>
    <h1>DATA SOURCES</h1>
    <p id="sources-sub"></p>
  </header>
  <div id="sources-list"></div>
</aside>
```

- [ ] **Step 7: Add the CSS**

Append inside the `THEME_CSS` template (before its closing backtick):

```css
  /* --- data sources panel (mirrors #panel) --- */
  #sources-panel {
    position: absolute; top: 0; right: var(--rail-w); bottom: 0; width: var(--panel-w);
    max-width: calc(100vw - var(--rail-w)); background: var(--panel);
    backdrop-filter: blur(6px); border-left: 1px solid var(--border);
    transform: translateX(110%); transition: transform 0.22s ease; z-index: 20;
    display: flex; flex-direction: column;
  }
  body.sources-open #sources-panel { transform: translateX(0); }
  #sources-panel header { padding: 1rem 1.25rem 0.6rem; border-bottom: 1px solid var(--border); }
  #sources-panel h1 { margin: 0; font-size: 1rem; letter-spacing: 0.04em; }
  #sources-sub { margin: 0.3rem 0 0; color: var(--muted); font-size: 0.78rem; }
  #sources-list { overflow-y: auto; padding: 0.5rem 1.25rem 1.5rem; flex: 1; }
  .src { padding: 0.7rem 0; border-bottom: 1px solid var(--border); }
  .src:last-child { border-bottom: none; }
  .src .nm { display: flex; align-items: center; font-size: 0.9rem; font-weight: 700; }
  .src .light {
    margin-left: auto; width: 11px; height: 11px; border-radius: 50%;
    background: var(--muted); box-shadow: 0 0 6px 1px var(--muted);
  }
  .src .light.recency-fresh { background: var(--fresh); box-shadow: 0 0 6px 1px var(--fresh); }
  .src .light.recency-recent { background: var(--recent); box-shadow: 0 0 6px 1px var(--recent); }
  .src .light.recency-stale { background: var(--high); box-shadow: 0 0 6px 1px var(--high); }
  .src .ds { color: var(--muted); font-size: 0.78rem; margin: 0.3rem 0 0.4rem; line-height: 1.4; }
  .src .links { font-size: 0.76rem; margin-bottom: 0.4rem; }
  .src .links a { color: var(--accent); text-decoration: none; }
  .src .links a.feed { color: var(--muted); }
  .src .links .sep { color: var(--border); margin: 0 0.45rem; }
  .src .updated { font-size: 0.76rem; }
  .src .failnote { font-size: 0.74rem; color: var(--muted); margin-top: 0.3rem; }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run test/render.test.ts`
Expected: PASS (existing tests + the 3 new ones).

- [ ] **Step 9: Commit**

```bash
git add src/render/dashboard.ts test/render.test.ts
git commit -m "feat(dashboard): sources panel shell, rail button, monochrome headers"
```

---

### Task 5: Client rendering, panel toggling, meta cleanup, route wiring

Populates the panel from the view-model, wires the mutually-exclusive rail toggles, removes the `feeds: …` fragment (and the now-dead `feedsLine`), and feeds real fetch-status into the render on the live route. Verified by typecheck + the live app (client is not unit-tested, per convention).

**Files:**
- Modify: `src/render/client.ts`
- Modify: `src/render/viewModel.ts` (remove `feedsLine`)
- Modify: `test/view-model.test.ts` (update the metadata test)
- Modify: `app/route.ts`

**Interfaces:**
- Consumes: `vm.dataSources`, `vm.lastFetchAttemptUtc`, `vm.dataSourcesStatusAvailable` (Task 3); DOM ids from Task 4; `lastFetchByFeed` (Task 1); `renderDashboard(model, geometryById, fetchStatus)` (Task 4).
- Produces: interactive Data Sources panel; the running dashboard route passing live fetch-status.

- [ ] **Step 1: Remove `feedsLine` from the view-model**

In `src/render/viewModel.ts`: delete the `feedsLine: string;` field from the `DashboardVM` interface and delete the `feedsLine: "USGS, GDACS, ReliefWeb",` line from the `buildViewModel` return object.

- [ ] **Step 2: Update the metadata test**

In `test/view-model.test.ts`, replace the "stamps run metadata" test with (drops the `feedsLine` assertion):

```ts
  it("stamps run metadata: generated time, total count", () => {
    const vm = buildViewModel(model({ surfaced: [surfaced({})] }));
    expect(vm.generatedUtc).toBe("2026-07-08T00:30:00.000Z");
    expect(vm.totalCount).toBe(1);
  });
```

- [ ] **Step 3: Drop the feeds fragment from the meta line**

In `src/render/client.ts`, change the meta line assignment (currently `"Generated " + vm.generatedUtc + " · feeds: " + vm.feedsLine + (vm.changesLine ? ...)`) to:

```js
  document.getElementById("meta").textContent =
    "Generated " + vm.generatedUtc + (vm.changesLine ? " · " + vm.changesLine : "");
```

- [ ] **Step 4: Update panel toggling to be mutually exclusive**

In `src/render/client.ts`, replace the existing `openPanel` / `togglePanel` functions with:

```js
  function openPanel() {
    document.body.classList.add("panel-open");
    document.body.classList.remove("sources-open");
  }

  function togglePanel() {
    document.body.classList.remove("sources-open");
    document.body.classList.toggle("panel-open");
  }

  function toggleSources() {
    document.body.classList.remove("panel-open");
    document.body.classList.toggle("sources-open");
  }
```

- [ ] **Step 5: Build the sources panel and wire the button**

In `src/render/client.ts`, add the button listener next to the existing rail listeners (after `document.getElementById("btn-status").addEventListener("click", openPanel);`):

```js
  document.getElementById("btn-sources").addEventListener("click", toggleSources);
```

Then add the builder (place it near the meta/notices rendering section; remember: no backticks, no `${`, `textContent` only, `↗` = ↗, `·` = ·, `⚠` = ⚠):

```js
  // --- data sources panel ---
  (function buildSources() {
    var sub = document.getElementById("sources-sub");
    sub.textContent = vm.lastFetchAttemptUtc
      ? "Last fetch attempt: " + vm.lastFetchAttemptUtc
      : "No runs recorded yet";

    var list = document.getElementById("sources-list");
    vm.dataSources.forEach(function (s) {
      var row = el("div", "src");

      var nm = el("div", "nm", s.feed);
      nm.appendChild(el("span", "light" + (s.recency ? " recency-" + s.recency : "")));
      row.appendChild(nm);

      row.appendChild(el("div", "ds", s.description));

      var links = el("div", "links");
      if (s.homeUrl) {
        var home = el("a", null, s.homeLabel + " ↗");
        home.href = s.homeUrl; home.target = "_blank"; home.rel = "noopener noreferrer";
        links.appendChild(home);
      }
      if (s.feedUrl) {
        if (links.childNodes.length) links.appendChild(el("span", "sep", "·"));
        var feed = el("a", "feed", "feed ↗");
        feed.href = s.feedUrl; feed.target = "_blank"; feed.rel = "noopener noreferrer";
        links.appendChild(feed);
      }
      row.appendChild(links);

      var updatedText = !vm.dataSourcesStatusAvailable
        ? "Fetch status unavailable"
        : (s.updatedAgeLabel ? "Updated: " + s.updatedAgeLabel : "No successful fetch yet");
      row.appendChild(el("div", "updated" + (s.recency ? " recency-" + s.recency : ""), updatedText));

      if (s.failureNote) {
        row.appendChild(el("div", "failnote", "⚠ " + s.failureNote));
      }

      list.appendChild(row);
    });
  })();
```

- [ ] **Step 6: Wire fetch-status into the route**

In `app/route.ts`:

Update the import:

```ts
import { latestSurfacedEvents, latestGeometryById, lastFetchByFeed } from "../src/db/reader.js";
```

Update the `Promise.all` and the `renderDashboard` call:

```ts
    const [events, geometryById, fetchStatus] = await Promise.all([
      latestSurfacedEvents(db),
      latestGeometryById(db).catch(() => ({})),
      // Best-effort: a failed status read degrades the tab to "unavailable",
      // it never 503s the page (mirrors the geometry read).
      lastFetchByFeed(db).catch(() => null),
    ]);
    const model = buildDbSitrepModel(events, new Date());
    const html = renderDashboard(model, geometryById, fetchStatus);
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: all pass; the DB suites (including `db-fetch-status`) skip when `DATABASE_URL` is unset. To exercise the reader test too: `docker start hadr-pg` then `DATABASE_URL=postgres://postgres:hadr@localhost:5432/hadr npx drizzle-kit migrate && DATABASE_URL=postgres://postgres:hadr@localhost:5432/hadr npm test`.

- [ ] **Step 8: Drive the live app**

With the DB reachable, start the app (`npm run dev`) and open `/`. Confirm:
- the `⛁` rail button opens the Data Sources panel and closes the events panel (and vice-versa);
- each feed shows name + right-aligned traffic-light dot, description, `homepage ↗ · feed ↗`, and a colour-matched `Updated: ~x ago`;
- the subheader reads `Last fetch attempt: <time>`;
- a feed missing from the latest run shows the muted `⚠ Failed to fetch updates at <time>`;
- the event panel meta line no longer contains `feeds: …`;
- both panel headers are single-colour white.

(If a project run/verify skill exists, use it to launch and screenshot.)

- [ ] **Step 9: Commit**

```bash
git add src/render/client.ts src/render/viewModel.ts test/view-model.test.ts app/route.ts
git commit -m "feat(dashboard): render Data Sources panel; drop feeds line from meta"
```

---

## Self-Review

**1. Spec coverage**
- Layout A rail button + dedicated panel, mutually exclusive → Task 4 (shell/CSS), Task 5 (toggling). ✓
- "Both" links (homepage + feed) → registry Task 2, VM Task 3, client Task 5. ✓
- Recency bands via `thresholds` → Task 3 (`recencyOf`). ✓
- Traffic-light dot on name row, right-aligned + colour-matched `Updated:` → Task 4 CSS, Task 5 client. ✓
- `Last fetch attempt` subheader → Task 3 (`lastFetchAttemptUtc`), Task 5 client. ✓
- Muted failure note `Failed to fetch updates at <time>` → Task 3 (`failureNote`), Task 5 client. ✓
- Never-fetched / status-unavailable states → Task 3 + Task 5. ✓
- Monochrome white headers (both panels) → Task 4. ✓
- Remove `feeds: …` from meta → Task 5. ✓
- Reader over `ingest_runs`, no schema change → Task 1. ✓
- `app/route.ts` best-effort wiring → Task 5. ✓
- Deviation recorded → Task 1 Step 6. ✓
- Tests: reader integration (gated), VM units, render smoke; no browser tests → Tasks 1/3/4. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**3. Type consistency:** `FetchStatus { latestRunAt, latestFeedsOk, lastOkByFeed }` defined in Task 1 and consumed identically in Tasks 3/4. `DataSourceVM` field names (`updatedAgeLabel`, `recency`, `failureNote`, `homeUrl`, `feedUrl`, `homeLabel`) match between Task 3 (produce) and Task 5 (consume). DOM ids (`btn-sources`, `sources-panel`, `sources-sub`, `sources-list`) and body class `sources-open` match between Task 4 (markup/CSS) and Task 5 (client). `renderDashboard(model, geometryById, fetchStatus)` signature consistent across Task 4 and Task 5. ✓
