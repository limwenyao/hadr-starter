# Platform Migration — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the re-platformed pipeline end-to-end on one feed — GitHub Actions ingestion writes bitemporally-versioned USGS events to a hosted Postgres, and a Next.js app on Vercel server-renders the existing dashboard from that database, with a source-updated/staleness display.

**Architecture:** The deterministic core (`buildSitrep`, parsers, view-model) is preserved; the migration adds I/O adapters around the seam — a DB **writer** on the ingestion side and a DB **reader** on the render side. Rendering reuses the existing `renderDashboard` verbatim, served on request by a Next.js root route handler (server-render-on-request, realizing the approved "Server Component" read-path intent while reusing the tested render pipeline). Data is stored append-only, one row per distinct upstream version.

**Tech Stack:** TypeScript (ESM, `strict`), Node 20; Next.js (App Router) on Vercel; Neon Postgres via Drizzle ORM (`drizzle-orm/postgres-js` + the `postgres` driver); Vitest.

## Global Constraints

- **Language/tooling:** TypeScript on Node 20 LTS, ESM (`"type": "module"`), `strict: true`. Import specifiers use `.js` extensions (ESM).
- **Deterministic core untouched:** `buildSitrep(feedResults, priorSnapshot, now)` and its callees make no network/LLM/DB calls. The writer/reader are adapters outside the seam (CLAUDE.md #1, #10).
- **Rules decide; LLM only describes.** No task changes inclusion/tier logic (CLAUDE.md #2).
- **Thresholds are named constants** in `src/thresholds.ts` (CLAUDE.md #3). New: `STALE_AFTER_MS`.
- **Never fail silently / never crash the run** (CLAUDE.md #4). DB failures degrade; the run exits non-zero but does not throw unhandled.
- **Never overstate freshness** (CLAUDE.md #5). Where a feed's update time is coarse/absent, mark `updateProvenance: "inferred"`; the UI presents freshness as an input for the officer, never a hard verdict.
- **Domain vocabulary** exactly (CONTEXT.md): surfaced event, priority tier, assessment.
- **Tests never hit network, call a model, or need a browser.** DB integration tests use a real local/CI Postgres via `DATABASE_URL`; drive logic through the seam and fixtures.
- **Bitemporal identity:** a stored version is unique on `(feed, feed_event_id, source_updated_at)`. Temporal features filter on source time; `ingested_at` is audit-only.
- **Transitional dual-write:** keep committing `data/YYYY-MM-DD.json` (ADR 0006 audit net) until a later ADR drops it.
- Governing ADR: 0011. Spec: `docs/superpowers/specs/2026-07-09-platform-migration-slice1-design.md`.

---

### Task 1: DB foundation — dependencies, Drizzle schema, migration, client

**Files:**
- Modify: `package.json` (dependencies + scripts)
- Create: `drizzle.config.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `.env.example`
- Create: `drizzle/` (generated migration output)

**Interfaces:**
- Produces: `eventVersions`, `ingestRuns` (Drizzle table objects) from `src/db/schema.ts`; `getDb(): PostgresJsDatabase` and `closeDb()` from `src/db/client.ts`; `EventVersionRow` (inferred insert type) and `IngestRunRow`.

- [ ] **Step 1: Provision Postgres (manual, one-time)**

Local dev/test DB (Docker):
```bash
docker run --name hadr-pg -e POSTGRES_PASSWORD=hadr -e POSTGRES_DB=hadr -p 5432:5432 -d postgres:16
```
Create `.env` (add `.env` to `.gitignore` first so it is never committed) with:
```
DATABASE_URL=postgres://postgres:hadr@localhost:5432/hadr
```
All local DB/tool commands below assume this URL; they pass it inline
(`DATABASE_URL="…" npx …`) because the Bash tool does not persist shell env
between calls. CI and Vercel supply `DATABASE_URL` via secrets/env (Tasks 9–10).
Provision Neon for later tasks (Vercel dashboard → Storage → Neon Postgres) and note its connection string; it will become the `DATABASE_URL` secret in Vercel and GitHub Actions (Tasks 9–10). Create `.env.example` documenting the variable:
```
DATABASE_URL=postgres://user:pass@host:5432/dbname
```

- [ ] **Step 2: Add dependencies**

Run:
```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit
```
Add scripts to `package.json` (`scripts` block):
```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

- [ ] **Step 3: Write the Drizzle schema**

Create `src/db/schema.ts`:
```ts
import {
  pgTable, bigserial, text, timestamp, doublePrecision, jsonb,
  boolean, integer, unique, index,
} from "drizzle-orm/pg-core";

export const eventVersions = pgTable(
  "event_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    feed: text("feed").notNull(),
    feedEventId: text("feed_event_id").notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    updateProvenance: text("update_provenance").notNull(), // 'source' | 'inferred'
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    tier: text("tier").notNull(),
    title: text("title").notNull(),
    locationName: text("location_name").notNull(),
    lon: doublePrecision("lon"),
    lat: doublePrecision("lat"),
    metrics: jsonb("metrics").notNull(),
    hazardType: text("hazard_type").notNull(),
    assessment: text("assessment"),
    footprint: jsonb("footprint"),
    sourceUrl: text("source_url"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniqVersion: unique("uniq_source_version").on(t.feed, t.feedEventId, t.sourceUpdatedAt),
    byEvent: index("idx_by_event").on(t.feed, t.feedEventId, t.sourceUpdatedAt.desc()),
    byEventTime: index("idx_event_time").on(t.eventTime),
    bySourceUpdated: index("idx_source_updated").on(t.sourceUpdatedAt),
  }),
);

export const ingestRuns = pgTable("ingest_runs", {
  runAt: timestamp("run_at", { withTimezone: true }).primaryKey(),
  feedsOk: text("feeds_ok").array().notNull(),
  feedsDown: jsonb("feeds_down").notNull(),   // [{ feed, reason }]
  surfacedCount: integer("surfaced_count").notNull(),
  dbWriteOk: boolean("db_write_ok").notNull(),
});

export type EventVersionRow = typeof eventVersions.$inferInsert;
export type IngestRunRow = typeof ingestRuns.$inferInsert;
```

- [ ] **Step 4: Write the client module**

Create `src/db/client.ts`:
```ts
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

let sql: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

/** Lazily create the singleton Drizzle client from DATABASE_URL. */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  sql = postgres(url, { max: 1 });
  db = drizzle(sql, { schema });
  return db;
}

/** Close the pool (tests / one-shot scripts). */
export async function closeDb(): Promise<void> {
  if (sql) await sql.end({ timeout: 5 });
  sql = null;
  db = null;
}
```

- [ ] **Step 5: Write the Drizzle config**

Create `drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 6: Generate and apply the migration**

Run:
```bash
npx drizzle-kit generate
DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx drizzle-kit migrate
```
Expected: a `drizzle/0000_*.sql` file is created; migrate prints applied migration. Verify tables:
```bash
docker exec -it hadr-pg psql -U postgres -d hadr -c "\d event_versions"
```
Expected: columns match the schema; `uniq_source_version` unique constraint present.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json drizzle.config.ts src/db/schema.ts src/db/client.ts .env.example drizzle/
git commit -m "feat(db): Neon/Drizzle foundation — bitemporal event_versions + ingest_runs schema"
```

---

### Task 2: USGS parser captures the upstream update time

**Files:**
- Modify: `src/types.ts` (extend `Event`)
- Modify: `src/feeds/usgs.ts:12-77` (parse `properties.updated`)
- Test: `test/usgs-parse.test.ts` (add cases)

**Interfaces:**
- Produces: `Event.sourceUpdatedAt?: number` (epoch ms) and `Event.updateProvenance?: "source" | "inferred"`. Consumed by Task 3's row mapping.

- [ ] **Step 1: Write the failing tests**

Add to `test/usgs-parse.test.ts` inside the `describe`:
```ts
it("captures properties.updated as sourceUpdatedAt with 'source' provenance", () => {
  const payload = { features: [{
    id: "us-upd",
    properties: { mag: 5.1, place: "x", time: 1783300000000, updated: 1783309999000 },
    geometry: { coordinates: [1, 2, 10] },
  }] };
  const e = parseUsgs(payload)[0];
  expect(e.sourceUpdatedAt).toBe(1783309999000);
  expect(e.updateProvenance).toBe("source");
});

it("falls back to event time as sourceUpdatedAt with 'inferred' provenance when updated is missing/invalid", () => {
  const missing = parseUsgs({ features: [{
    id: "us-noupd", properties: { mag: 5.1, place: "x", time: 1783300000000 },
    geometry: { coordinates: [1, 2] },
  }] })[0];
  expect(missing.sourceUpdatedAt).toBe(1783300000000);
  expect(missing.updateProvenance).toBe("inferred");

  const bad = parseUsgs({ features: [{
    id: "us-badupd", properties: { mag: 5.1, place: "x", time: 1783300000000, updated: "nope" },
    geometry: { coordinates: [1, 2] },
  }] })[0];
  expect(bad.updateProvenance).toBe("inferred");
  expect(bad.sourceUpdatedAt).toBe(1783300000000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- usgs-parse`
Expected: FAIL — `sourceUpdatedAt`/`updateProvenance` are `undefined`.

- [ ] **Step 3: Extend the Event type**

In `src/types.ts`, add to `interface Event` (after `time`):
```ts
  /**
   * Upstream last-modified time, epoch ms UTC (bitemporal source clock, ADR 0011).
   * `updateProvenance` records whether this came from the source or was inferred
   * from `time` when the feed exposes no usable update stamp (never overstate).
   */
  sourceUpdatedAt?: number;
  updateProvenance?: "source" | "inferred";
```

- [ ] **Step 4: Parse `properties.updated`**

In `src/feeds/usgs.ts`, add `updated?: unknown;` to the `UsgsFeature.properties` type (after `time?: unknown;`). Then in `parseFeature`, before the `return`, compute:
```ts
  const hasUpdated = typeof props.updated === "number" && isValidEventTime(props.updated);
  const sourceUpdatedAt = hasUpdated ? (props.updated as number) : props.time;
  const updateProvenance = hasUpdated ? "source" as const : "inferred" as const;
```
and add to the returned object (after `time: props.time,`):
```ts
    sourceUpdatedAt,
    updateProvenance,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- usgs-parse`
Expected: PASS (all existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/feeds/usgs.ts test/usgs-parse.test.ts
git commit -m "feat(usgs): capture upstream properties.updated as sourceUpdatedAt (source|inferred)"
```

---

### Task 3: Pure mapping — SurfacedEvent → event_versions row

**Files:**
- Create: `src/db/mapping.ts`
- Test: `test/db-mapping.test.ts`

**Interfaces:**
- Consumes: `SurfacedEvent` (with `sourceUpdatedAt`/`updateProvenance` from Task 2), `EventVersionRow` (Task 1).
- Produces: `surfacedEventToRow(event: SurfacedEvent, ingestedAt: Date): EventVersionRow` and `rowToSurfacedEvent(row): SurfacedEvent`.

- [ ] **Step 1: Write the failing tests**

Create `test/db-mapping.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { surfacedEventToRow, rowToSurfacedEvent } from "../src/db/mapping.js";
import type { SurfacedEvent } from "../src/types.js";

const base: SurfacedEvent = {
  feed: "USGS", feedEventId: "us1", hazardType: "EQ",
  title: "M 6.0 - somewhere", locationName: "somewhere",
  coordinates: { lon: 10, lat: -5, depthKm: 12 },
  time: Date.UTC(2026, 6, 9, 3, 0), metrics: { mag: 6.0, pagerAlert: "orange" },
  tier: "CRITICAL", assessment: "Prose.", sourceUrl: "https://usgs.gov/x",
  sourceUpdatedAt: Date.UTC(2026, 6, 9, 4, 0), updateProvenance: "source",
};

describe("surfacedEventToRow", () => {
  it("maps identity, both clocks, and splits coordinates into lon/lat", () => {
    const row = surfacedEventToRow(base, new Date(Date.UTC(2026, 6, 9, 5, 0)));
    expect(row).toMatchObject({
      feed: "USGS", feedEventId: "us1", tier: "CRITICAL", hazardType: "EQ",
      title: "M 6.0 - somewhere", locationName: "somewhere",
      lon: 10, lat: -5, assessment: "Prose.", sourceUrl: "https://usgs.gov/x",
      updateProvenance: "source",
    });
    expect(row.eventTime).toEqual(new Date(Date.UTC(2026, 6, 9, 3, 0)));
    expect(row.sourceUpdatedAt).toEqual(new Date(Date.UTC(2026, 6, 9, 4, 0)));
    expect(row.ingestedAt).toEqual(new Date(Date.UTC(2026, 6, 9, 5, 0)));
    expect(row.metrics).toEqual({ mag: 6.0, pagerAlert: "orange" });
  });

  it("uses event time + 'inferred' when sourceUpdatedAt is absent", () => {
    const { sourceUpdatedAt, updateProvenance, ...rest } = base;
    const row = surfacedEventToRow(rest as SurfacedEvent, new Date(0));
    expect(row.sourceUpdatedAt).toEqual(new Date(Date.UTC(2026, 6, 9, 3, 0)));
    expect(row.updateProvenance).toBe("inferred");
  });

  it("null lon/lat for events without coordinates (ReliefWeb list-only)", () => {
    const { coordinates, ...rest } = base;
    const row = surfacedEventToRow(rest as SurfacedEvent, new Date(0));
    expect(row.lon).toBeNull();
    expect(row.lat).toBeNull();
  });

  it("round-trips through rowToSurfacedEvent", () => {
    const row = surfacedEventToRow(base, new Date(Date.UTC(2026, 6, 9, 5, 0)));
    const back = rowToSurfacedEvent({ ...row, id: 1 });
    expect(back.feedEventId).toBe("us1");
    expect(back.coordinates).toEqual({ lon: 10, lat: -5 });
    expect(back.time).toBe(Date.UTC(2026, 6, 9, 3, 0));
    expect(back.sourceUpdatedAt).toBe(Date.UTC(2026, 6, 9, 4, 0));
    expect(back.tier).toBe("CRITICAL");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- db-mapping`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the mapping**

Create `src/db/mapping.ts`:
```ts
import type { SurfacedEvent, FeedName, Tier, FootprintSummary } from "../types.js";
import type { EventVersionRow } from "./schema.js";

/** Pure SurfacedEvent → row. Falls back to event time when no source update stamp. */
export function surfacedEventToRow(event: SurfacedEvent, ingestedAt: Date): EventVersionRow {
  const sourceUpdatedMs = event.sourceUpdatedAt ?? event.time;
  const provenance = event.updateProvenance ?? "inferred";
  return {
    feed: event.feed,
    feedEventId: event.feedEventId,
    sourceUpdatedAt: new Date(sourceUpdatedMs),
    updateProvenance: provenance,
    eventTime: new Date(event.time),
    tier: event.tier,
    title: event.title,
    locationName: event.locationName,
    lon: event.coordinates?.lon ?? null,
    lat: event.coordinates?.lat ?? null,
    metrics: event.metrics,
    hazardType: event.hazardType,
    assessment: event.assessment ?? null,
    footprint: event.footprint ?? null,
    sourceUrl: event.sourceUrl ?? null,
    ingestedAt,
  };
}

/** Row (post-select) → SurfacedEvent for the render path. */
export function rowToSurfacedEvent(row: EventVersionRow & { id?: number }): SurfacedEvent {
  const lon = row.lon;
  const lat = row.lat;
  return {
    feed: row.feed as FeedName,
    feedEventId: row.feedEventId,
    hazardType: row.hazardType,
    title: row.title,
    locationName: row.locationName,
    coordinates: lon != null && lat != null ? { lon, lat } : undefined,
    time: new Date(row.eventTime).getTime(),
    sourceUpdatedAt: new Date(row.sourceUpdatedAt).getTime(),
    updateProvenance: row.updateProvenance as "source" | "inferred",
    metrics: row.metrics as SurfacedEvent["metrics"],
    tier: row.tier as Tier,
    assessment: row.assessment ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    footprint: (row.footprint as FootprintSummary | null) ?? undefined,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- db-mapping`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/mapping.ts test/db-mapping.test.ts
git commit -m "feat(db): pure SurfacedEvent<->event_versions row mapping"
```

---

### Task 4: DB writer + latest-state reader (integration, real Postgres)

**Files:**
- Create: `src/db/writer.ts`
- Create: `src/db/reader.ts`
- Test: `test/db-integration.test.ts`
- Create: `test/helpers/db.ts`

**Interfaces:**
- Consumes: `getDb` (Task 1), mappings (Task 3).
- Produces: `insertEventVersions(db, rows): Promise<number>` (returns rows inserted), `recordIngestRun(db, run): Promise<void>`, `latestSurfacedEvents(db): Promise<SurfacedEvent[]>`.

- [ ] **Step 1: Write the test helper**

Create `test/helpers/db.ts`:
```ts
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../../src/db/client.js";

export async function resetDb() {
  const db = getDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.execute(sql`TRUNCATE TABLE event_versions RESTART IDENTITY`);
  await db.execute(sql`TRUNCATE TABLE ingest_runs`);
  return db;
}
export { closeDb };
```

- [ ] **Step 2: Write the failing integration tests**

Create `test/db-integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resetDb, closeDb } from "./helpers/db.js";
import { insertEventVersions } from "../src/db/writer.js";
import { latestSurfacedEvents } from "../src/db/reader.js";
import { surfacedEventToRow } from "../src/db/mapping.js";
import type { SurfacedEvent } from "../src/types.js";

const ev = (over: Partial<SurfacedEvent> = {}): SurfacedEvent => ({
  feed: "USGS", feedEventId: "us1", hazardType: "EQ", title: "t", locationName: "l",
  coordinates: { lon: 1, lat: 2 }, time: Date.UTC(2026, 6, 9, 0, 0),
  metrics: { mag: 6 }, tier: "HIGH",
  sourceUpdatedAt: Date.UTC(2026, 6, 9, 1, 0), updateProvenance: "source", ...over,
});

describe("db writer + reader", () => {
  beforeAll(async () => { await resetDb(); });
  afterEach(async () => { await resetDb(); });
  afterAll(async () => { await closeDb(); });

  it("inserts one row per distinct source version; dedups unchanged re-ingests", async () => {
    const db = await resetDb();
    const row = surfacedEventToRow(ev(), new Date());
    expect(await insertEventVersions(db, [row])).toBe(1);
    expect(await insertEventVersions(db, [row])).toBe(0); // same source version → dedup
  });

  it("adds a new row when sourceUpdatedAt advances", async () => {
    const db = await resetDb();
    await insertEventVersions(db, [surfacedEventToRow(ev(), new Date())]);
    const revised = ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 2, 0), metrics: { mag: 6.3 } });
    expect(await insertEventVersions(db, [surfacedEventToRow(revised, new Date())])).toBe(1);
  });

  it("latest-state returns the newest version per event", async () => {
    const db = await resetDb();
    await insertEventVersions(db, [surfacedEventToRow(ev({ metrics: { mag: 6 } }), new Date())]);
    await insertEventVersions(db, [surfacedEventToRow(
      ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 2, 0), metrics: { mag: 6.5 } }), new Date())]);
    const latest = await latestSurfacedEvents(db);
    expect(latest).toHaveLength(1);
    expect(latest[0].metrics.mag).toBe(6.5);
    expect(latest[0].sourceUpdatedAt).toBe(Date.UTC(2026, 6, 9, 2, 0));
  });

  it("late (earlier) source version does not become 'latest'", async () => {
    const db = await resetDb();
    await insertEventVersions(db, [surfacedEventToRow(
      ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 2, 0), metrics: { mag: 6.5 } }), new Date())]);
    await insertEventVersions(db, [surfacedEventToRow(
      ev({ sourceUpdatedAt: Date.UTC(2026, 6, 9, 1, 0), metrics: { mag: 6.0 } }), new Date())]);
    const latest = await latestSurfacedEvents(db);
    expect(latest[0].metrics.mag).toBe(6.5);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx vitest run db-integration`
Expected: FAIL — `writer.js`/`reader.js` not found.

- [ ] **Step 4: Write the writer**

Create `src/db/writer.ts`:
```ts
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eventVersions, ingestRuns, type EventVersionRow, type IngestRunRow } from "./schema.js";
import type * as schema from "./schema.js";

type Db = PostgresJsDatabase<typeof schema>;

/** Append rows, deduping on the source-version unique key. Returns rows inserted. */
export async function insertEventVersions(db: Db, rows: EventVersionRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db.insert(eventVersions).values(rows)
    .onConflictDoNothing({ target: [eventVersions.feed, eventVersions.feedEventId, eventVersions.sourceUpdatedAt] })
    .returning({ id: eventVersions.id });
  return inserted.length;
}

export async function recordIngestRun(db: Db, run: IngestRunRow): Promise<void> {
  await db.insert(ingestRuns).values(run)
    .onConflictDoUpdate({ target: ingestRuns.runAt, set: run });
}
```

- [ ] **Step 5: Write the reader**

Create `src/db/reader.ts`:
```ts
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";
import type { EventVersionRow } from "./schema.js";
import { rowToSurfacedEvent } from "./mapping.js";
import type { SurfacedEvent } from "../types.js";

type Db = PostgresJsDatabase<typeof schema>;

/** Newest version per (feed, feed_event_id) — the current surfaced set. */
export async function latestSurfacedEvents(db: Db): Promise<SurfacedEvent[]> {
  const rows = await db.execute<EventVersionRow>(sql`
    SELECT DISTINCT ON (feed, feed_event_id) *
    FROM event_versions
    ORDER BY feed, feed_event_id, source_updated_at DESC
  `);
  // postgres-js returns snake_case; map explicitly to the camelCase row shape.
  return (rows as unknown as Record<string, unknown>[]).map((r) => rowToSurfacedEvent({
    feed: r.feed as string, feedEventId: r.feed_event_id as string,
    sourceUpdatedAt: r.source_updated_at as Date, updateProvenance: r.update_provenance as string,
    eventTime: r.event_time as Date, tier: r.tier as string, title: r.title as string,
    locationName: r.location_name as string, lon: r.lon as number | null, lat: r.lat as number | null,
    metrics: r.metrics, hazardType: r.hazard_type as string,
    assessment: (r.assessment ?? null) as string | null, footprint: r.footprint ?? null,
    sourceUrl: (r.source_url ?? null) as string | null, ingestedAt: r.ingested_at as Date,
  } as unknown as EventVersionRow));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx vitest run db-integration`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/db/writer.ts src/db/reader.ts test/db-integration.test.ts test/helpers/db.ts
git commit -m "feat(db): version-dedup writer + DISTINCT ON latest-state reader"
```

---

### Task 5: View-model staleness fields

**Files:**
- Modify: `src/thresholds.ts` (add `STALE_AFTER_MS`)
- Modify: `src/render/viewModel.ts` (extend `EventCardVM` + `cardFor`)
- Test: `test/view-model.test.ts` (add cases)

**Interfaces:**
- Consumes: `SurfacedEvent.sourceUpdatedAt`/`updateProvenance`, `model.generatedAt` (the reference clock).
- Produces: on `EventCardVM` — `sourceUpdatedUtc: string`, `sourceUpdatedAgeLabel: string`, `stalenessHint: boolean`, `updateProvenance: "source" | "inferred"`.

- [ ] **Step 1: Write the failing tests**

Add to `test/view-model.test.ts`:
```ts
it("computes source-updated fields and a stale hint past the threshold", () => {
  const gen = Date.UTC(2026, 6, 9, 12, 0);
  const vm = buildViewModel(model({
    generatedAt: gen,
    surfaced: [surfaced({ sourceUpdatedAt: gen - 2 * 3600_000, updateProvenance: "source" })],
  }));
  const card = vm.tiers[0].events[0];
  expect(card.sourceUpdatedUtc).toBe("2026-07-09T10:00:00.000Z");
  expect(card.sourceUpdatedAgeLabel).toBe("~2h ago");
  expect(card.updateProvenance).toBe("source");
  expect(card.stalenessHint).toBe(false);
});

it("flags stalenessHint when the source update is older than STALE_AFTER_MS", () => {
  const gen = Date.UTC(2026, 6, 9, 12, 0);
  const vm = buildViewModel(model({
    generatedAt: gen,
    surfaced: [surfaced({ sourceUpdatedAt: gen - 48 * 3600_000, updateProvenance: "source" })],
  }));
  expect(vm.tiers[0].events[0].stalenessHint).toBe(true);
});

it("falls back to event time + 'inferred' when no source update time", () => {
  const gen = Date.UTC(2026, 6, 9, 12, 0);
  const vm = buildViewModel(model({
    generatedAt: gen,
    surfaced: [surfaced({ time: gen - 3600_000, sourceUpdatedAt: undefined, updateProvenance: undefined })],
  }));
  const card = vm.tiers[0].events[0];
  expect(card.updateProvenance).toBe("inferred");
  expect(card.sourceUpdatedUtc).toBe("2026-07-09T11:00:00.000Z");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- view-model`
Expected: FAIL — properties undefined.

- [ ] **Step 3: Add the threshold constant**

In `src/thresholds.ts`, add:
```ts
/**
 * Freshness hint (ADR 0011). A surfaced event whose upstream source has not been
 * updated within this window shows a soft "possibly stale" hint — an input for the
 * duty officer's own judgement, never a hard verdict (CLAUDE.md #5). Tunable.
 */
export const STALE_AFTER_MS = 24 * 60 * 60_000; // 24h
```

- [ ] **Step 4: Extend the view-model**

In `src/render/viewModel.ts`: import `formatUtc` (already imported) and add `import { STALE_AFTER_MS } from "../thresholds.js";`. Add to `interface EventCardVM`:
```ts
  /** Upstream last-updated time, formatted UTC (bitemporal source clock). */
  sourceUpdatedUtc: string;
  /** Human relative age of the source update, e.g. "~2h ago". */
  sourceUpdatedAgeLabel: string;
  /** Source update older than STALE_AFTER_MS — soft hint only. */
  stalenessHint: boolean;
  /** Whether the update time came from the source or was inferred from event time. */
  updateProvenance: "source" | "inferred";
```
Add a helper above `cardFor`:
```ts
function ageLabel(ms: number): string {
  if (ms < 0) ms = 0;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `~${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `~${hrs}h ago`;
  return `~${Math.round(hrs / 24)}d ago`;
}
```
Change `cardFor(event)` to `cardFor(event, generatedAt: number)` and add to the returned object:
```ts
    sourceUpdatedUtc: formatUtc(event.sourceUpdatedAt ?? event.time),
    sourceUpdatedAgeLabel: ageLabel(generatedAt - (event.sourceUpdatedAt ?? event.time)),
    stalenessHint: generatedAt - (event.sourceUpdatedAt ?? event.time) > STALE_AFTER_MS,
    updateProvenance: event.updateProvenance ?? "inferred",
```
In `buildViewModel`, pass the clock: `.map((e) => cardFor(e, model.generatedAt))`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- view-model`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/thresholds.ts src/render/viewModel.ts test/view-model.test.ts
git commit -m "feat(render): source-updated + staleness-hint fields in the view-model"
```

---

### Task 6: Dashboard shows the source-updated time & staleness

**Files:**
- Modify: `src/render/client.ts` (card + row rendering)
- Modify: `src/render/dashboard.ts` (`THEME_CSS`: `.stale` chip, `.updated-line`)

**Interfaces:**
- Consumes: `EventCardVM` staleness fields (Task 5). No new exports.

Note: the client script is not unit-tested (tests run no browser — existing convention); verified via a live render in Task 7/8.

- [ ] **Step 1: Render the source-updated line in the detail card**

In `src/render/client.ts` `buildCard`, after the `card-meta` line (`card.appendChild(meta);`), add:
```js
    var upd = el("p", "card-updated",
      "Source updated " + ev.sourceUpdatedUtc + " (" + ev.sourceUpdatedAgeLabel + ")" +
      (ev.updateProvenance === "inferred" ? " · approximate" : ""));
    card.appendChild(upd);
    if (ev.stalenessHint) chips.appendChild(el("span", "chip stale", "POSSIBLY STALE"));
```
(The `chips` element is already built above; appending after keeps the chip with the tier/feed chips.)

- [ ] **Step 2: Render staleness on the list row**

In `src/render/client.ts`, in the tier-row builder, after `row.appendChild(el("div", "row-meta", ...))`, add:
```js
      row.appendChild(el("div", "row-updated",
        "upd " + ev.sourceUpdatedAgeLabel + (ev.updateProvenance === "inferred" ? " (approx)" : "")));
      if (ev.stalenessHint) chips.appendChild(el("span", "chip stale", "STALE?"));
```
(Insert the chip line before `row.appendChild(chips)` so it appears in the chip row — move accordingly: append the stale chip to `chips` right after the feed/new/updated chips, before `row.appendChild(chips)`.)

- [ ] **Step 3: Add CSS**

In `src/render/dashboard.ts` `THEME_CSS`, add near the chip rules:
```css
  .chip.stale { color: var(--high); background: rgba(245, 158, 11, 0.12); }
  .card-updated, .row-updated { color: var(--muted); font-size: 0.72rem; margin: 0.15rem 0 0; }
```

- [ ] **Step 4: Verify by rendering (no browser test)**

Run: `npm run typecheck`
Expected: PASS (no type errors). Visual verification happens in Task 8's live run.

- [ ] **Step 5: Commit**

```bash
git add src/render/client.ts src/render/dashboard.ts
git commit -m "feat(dashboard): show source-updated time + staleness hint on cards and rows"
```

---

### Task 7: Next.js app — dashboard route (from DB) + /api/events

**Files:**
- Modify: `package.json` (next/react deps + scripts)
- Create: `next.config.mjs`
- Create: `app/route.ts` (root GET → dashboard HTML from DB)
- Create: `app/api/events/route.ts` (GET → JSON)
- Create: `src/render/fromDb.ts` (rows → SitrepModel)
- Modify: `tsconfig.json` (jsx/next types if needed) — only if `npm run typecheck` complains
- Create: `.gitignore` entry for `.next`, `.env`

**Interfaces:**
- Consumes: `getDb` (Task 1), `latestSurfacedEvents` (Task 4), `renderDashboard` (existing), `buildViewModel` (existing).
- Produces: `buildDbSitrepModel(events: SurfacedEvent[], now: Date): SitrepModel`.

- [ ] **Step 1: Add Next.js + React**

Run:
```bash
npm install next react react-dom
npm install -D @types/react @types/react-dom
```
Add scripts to `package.json`:
```json
"dev": "next dev",
"build": "next build",
"start": "next start"
```
Create `next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = { serverExternalPackages: ["postgres"] };
export default nextConfig;
```
Append to `.gitignore`:
```
.next
.env
```

- [ ] **Step 2: Write the rows→SitrepModel adapter**

Create `src/render/fromDb.ts`:
```ts
import type { SitrepModel, SurfacedEvent } from "../types.js";

const SEVERITY = { CRITICAL: 0, HIGH: 1, MODERATE: 2 } as const;

/** Synthesise a SitrepModel from DB rows for the render path (slice 1: no
 *  degradation/withdrawn/change data — those come from ingest_runs later). */
export function buildDbSitrepModel(events: SurfacedEvent[], now: Date): SitrepModel {
  const surfaced = [...events].sort(
    (a, b) => SEVERITY[a.tier] - SEVERITY[b.tier] || (b.metrics.mag ?? 0) - (a.metrics.mag ?? 0),
  );
  return {
    generatedAt: now.getTime(),
    surfaced,
    degradation: [],
    withdrawn: [],
    changeSummary: null,
  };
}
```

- [ ] **Step 3: Write the dashboard route**

Create `app/route.ts`:
```ts
import { getDb } from "../src/db/client.js";
import { latestSurfacedEvents } from "../src/db/reader.js";
import { buildDbSitrepModel } from "../src/render/fromDb.js";
import { renderDashboard } from "../src/render/dashboard.js";

export const dynamic = "force-dynamic"; // always read current DB state

export async function GET() {
  try {
    const events = await latestSurfacedEvents(getDb());
    const model = buildDbSitrepModel(events, new Date());
    // Slice 1: impact geometry is not persisted, so render with no polygons.
    const html = renderDashboard(model, {});
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      `<!doctype html><meta charset=utf-8><body style="font:14px system-ui;padding:2rem">` +
      `<h1>HADR Monitor</h1><p>Dashboard data is temporarily unavailable.</p>` +
      `<p style="color:#888">(${msg.replace(/</g, "&lt;")})</p>`,
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}
```

- [ ] **Step 4: Write the JSON endpoint**

Create `app/api/events/route.ts`:
```ts
import { getDb } from "../../../src/db/client.js";
import { latestSurfacedEvents } from "../../../src/db/reader.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await latestSurfacedEvents(getDb());
  return Response.json({ events });
}
```

- [ ] **Step 5: Seed and verify locally**

Seed one row (via `tsx`, which resolves the TypeScript sources — plain `node` cannot), then run the app (Next auto-loads `.env`):
```bash
DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx tsx -e "import('./src/db/client.js').then(async ({getDb,closeDb})=>{const {insertEventVersions}=await import('./src/db/writer.js');const {surfacedEventToRow}=await import('./src/db/mapping.js');await insertEventVersions(getDb(),[surfacedEventToRow({feed:'USGS',feedEventId:'seed1',hazardType:'EQ',title:'M 6.4 - seed',locationName:'seedland',coordinates:{lon:120,lat:15},time:Date.now()-7200000,metrics:{mag:6.4,pagerAlert:'orange'},tier:'CRITICAL',assessment:'Seed assessment.',sourceUpdatedAt:Date.now()-3600000,updateProvenance:'source'},new Date())]);await closeDb();})"
npx next dev
```
In another shell:
```bash
curl -s localhost:3000/api/events | head -c 400
curl -s localhost:3000/ | grep -o "sitrep-data"
```
Expected: JSON contains the seeded event; the page HTML contains the `sitrep-data` payload block. Open `localhost:3000` in a browser: the map + panel render, the card shows "Source updated … (~1h ago)".

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.mjs app/ src/render/fromDb.ts .gitignore tsconfig.json
git commit -m "feat(app): Next.js dashboard route + /api/events reading latest state from DB"
```

---

### Task 8: Ingestion writes to the database (transitional dual-write)

**Files:**
- Create: `src/db/persist.ts`
- Modify: `src/run.ts:57-66` (persist to DB after render)
- Test: `test/db-persist.test.ts`

**Interfaces:**
- Consumes: `insertEventVersions`, `recordIngestRun` (Task 4), `surfacedEventToRow` (Task 3).
- Produces: `persistRun(db, assessed: SitrepModel, feedResults: FeedResult[], now: Date): Promise<{ inserted: number; dbWriteOk: boolean }>`.

- [ ] **Step 1: Write the failing test**

Create `test/db-persist.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { resetDb, closeDb } from "./helpers/db.js";
import { sql } from "drizzle-orm";
import { persistRun } from "../src/db/persist.js";
import type { SitrepModel, FeedResult } from "../src/types.js";

const model = (surfaced: SitrepModel["surfaced"]): SitrepModel => ({
  generatedAt: Date.UTC(2026, 6, 9, 8, 0), surfaced, degradation: [], withdrawn: [], changeSummary: null,
});
const okFeeds: FeedResult[] = [{ feed: "USGS", status: "ok", rawPayload: {} }];

describe("persistRun", () => {
  beforeAll(async () => { await resetDb(); });
  afterEach(async () => { await resetDb(); });
  afterAll(async () => { await closeDb(); });

  it("writes surfaced events and records an ingest_run with db_write_ok=true", async () => {
    const db = await resetDb();
    const res = await persistRun(db, model([{
      feed: "USGS", feedEventId: "us1", hazardType: "EQ", title: "t", locationName: "l",
      coordinates: { lon: 1, lat: 2 }, time: Date.UTC(2026, 6, 9, 7, 0), metrics: { mag: 6 },
      tier: "HIGH", sourceUpdatedAt: Date.UTC(2026, 6, 9, 7, 30), updateProvenance: "source",
    }]), okFeeds, new Date(Date.UTC(2026, 6, 9, 8, 0)));
    expect(res).toEqual({ inserted: 1, dbWriteOk: true });
    const runs = await db.execute(sql`SELECT surfaced_count, db_write_ok FROM ingest_runs`);
    expect((runs as unknown as any[])[0].surfaced_count).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx vitest run db-persist`
Expected: FAIL — `persist.js` not found.

- [ ] **Step 3: Write persistRun**

Create `src/db/persist.ts`:
```ts
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";
import type { SitrepModel, FeedResult } from "../types.js";
import { insertEventVersions, recordIngestRun } from "./writer.js";
import { surfacedEventToRow } from "./mapping.js";

type Db = PostgresJsDatabase<typeof schema>;

export async function persistRun(
  db: Db, assessed: SitrepModel, feedResults: FeedResult[], now: Date,
): Promise<{ inserted: number; dbWriteOk: boolean }> {
  const rows = assessed.surfaced.map((e) => surfacedEventToRow(e, now));
  const inserted = await insertEventVersions(db, rows);
  await recordIngestRun(db, {
    runAt: now,
    feedsOk: feedResults.filter((f) => f.status === "ok").map((f) => f.feed),
    feedsDown: feedResults.filter((f) => f.status === "unavailable")
      .map((f) => ({ feed: f.feed, reason: (f as { error: string }).error })),
    surfacedCount: assessed.surfaced.length,
    dbWriteOk: true,
  });
  return { inserted, dbWriteOk: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx vitest run db-persist`
Expected: PASS.

- [ ] **Step 5: Wire into run.ts (graceful, non-crashing)**

In `src/run.ts`, after `writeSnapshot("data", now, assessed);` (line ~65), add:
```ts
  // Transitional dual-write (ADR 0011): the DB is the new source of truth; the
  // JSON snapshot above stays as the git audit net. A DB failure must not crash
  // the run or lose the snapshot — log it, flag it, exit non-zero (CLAUDE.md #4).
  if (process.env.DATABASE_URL) {
    const { getDb, closeDb } = await import("./db/client.js");
    const { persistRun } = await import("./db/persist.js");
    try {
      const { inserted } = await persistRun(getDb(), assessed, feedResults, now);
      console.log(`db: wrote ${inserted} new event version(s)`);
    } catch (dbErr) {
      console.error(`db write failed (dashboard still served from last good state): ${String(dbErr)}`);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  } else {
    console.log("db: DATABASE_URL unset — skipped DB write (snapshot-only run)");
  }
```

- [ ] **Step 6: Verify the full run writes to the DB**

Run: `DATABASE_URL="postgres://postgres:hadr@localhost:5432/hadr" npx tsx src/run.ts`
Expected: logs `surfaced N event(s)` and `db: wrote M new event version(s)`; a second run logs `wrote 0 new` for unchanged USGS events (dedup). Then `curl -s localhost:3000/api/events` (with `next dev` running) shows real USGS events.

- [ ] **Step 7: Commit**

```bash
git add src/db/persist.ts src/run.ts test/db-persist.test.ts
git commit -m "feat(ingest): dual-write surfaced events to Postgres + ingest_runs, degrade on failure"
```

---

### Task 9: CI Postgres + scheduled workflow writes to Neon + doc updates

**Files:**
- Modify: `.github/workflows/sitrep.yml` (DATABASE_URL secret)
- Create/Modify: the test CI workflow (add a Postgres service)
- Modify: `CLAUDE.md` (record the build-step deviation)
- Modify: `implementation-notes.md` (Deviations entry)

**Interfaces:** none (infra + docs).

- [ ] **Step 1: Add Postgres to the test CI**

In the workflow that runs `npm test` (create `.github/workflows/test.yml` if none runs tests), add a service and env:
```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: hadr, POSTGRES_DB: hadr }
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 10s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgres://postgres:hadr@localhost:5432/hadr
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx drizzle-kit migrate   # apply committed migrations (drizzle/)
      - run: npm test
      - run: npm run typecheck
```

- [ ] **Step 2: Give the scheduled ingestion the DB secret**

In `.github/workflows/sitrep.yml`, add to the run step's `env`:
```yaml
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
```
Set the repo secret `DATABASE_URL` to the Neon connection string (Settings → Secrets → Actions). Cadence stays daily this slice (hourly is Slice 2).

- [ ] **Step 3: Record the build-step deviation in CLAUDE.md**

Under CLAUDE.md "Language & tooling", append:
```markdown
- **App build step (ADR 0011):** the deployed app is a **Next.js** project on Vercel and
  therefore has a build step, superseding the "no build step" rule *for the app*. The
  pure core (`src/`) and its scripts still run under **tsx**; tests still use Vitest.
```

- [ ] **Step 4: Record the deviation in implementation-notes.md**

Under "Deviations", add:
```markdown
- **2026-07-09 — Platform migration (ADR 0011), Slice 1.** Introduced a hosted Postgres
  (Neon) + Drizzle and a Next.js app on Vercel, superseding the static/no-DB v1 design
  (ADRs 0005/0006) and adding a build step (CLAUDE.md tooling note updated). Events are
  stored bitemporally (one row per upstream version). JSON snapshots are dual-written as
  a transitional audit net. Only USGS captures a real `source_updated_at` this slice;
  GDACS/ReliefWeb fall back to `inferred` until Slice 2.
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ CLAUDE.md implementation-notes.md
git commit -m "chore(ci): CI Postgres + scheduled DB write; record ADR 0011 deviations"
```

---

### Task 10: Deploy to Vercel

**Files:** none (deployment configuration in the Vercel dashboard).

**Interfaces:** none.

- [ ] **Step 1: Connect and configure**

In the Vercel dashboard: import the GitHub repo; framework preset **Next.js**. Add the environment variable `DATABASE_URL` = the Neon connection string (Production + Preview). Ensure the Neon integration/pooled connection string is used.

- [ ] **Step 2: Deploy from the branch**

Push the branch and open a PR, or deploy the branch as a Preview:
```bash
git push -u origin platform-migration-slice1
```
Vercel builds and gives a Preview URL.

- [ ] **Step 3: Smoke-test the deployment**

After the daily workflow (or a manual `FORCE=true` run) has written rows to Neon:
```bash
curl -s <preview-url>/api/events | head -c 400
```
Expected: JSON with current USGS events. Open `<preview-url>/` — the dashboard renders from Neon, cards show source-updated/staleness. If the DB is empty, the page returns the 503 "temporarily unavailable" fallback (never a crash).

- [ ] **Step 4: Verify end-to-end**

Confirm the full loop: GitHub Actions run → rows in Neon → Vercel page reflects them. Record the Preview/Production URL in the PR description.

---

## Notes for the executor

- Run DB-touching tests with `DATABASE_URL` set (local Docker Postgres or CI service). Pure tests (Tasks 2, 3, 5) need no DB.
- Do **not** touch the pre-existing uncommitted `dashboard.html` / `data/2026-07-09.json` working-tree changes — they predate this work.
- Keep the deterministic core (`buildSitrep` and callees) free of DB/network imports.
