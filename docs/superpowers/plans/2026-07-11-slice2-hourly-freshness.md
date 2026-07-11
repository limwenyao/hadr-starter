# Slice 2 — Hourly Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest hourly so the DB (and the live Vercel dashboard) is fresh within the hour, give GDACS a real `datemodified` update time, and assess event-driven (only when something changed since the previous run) instead of once daily.

**Architecture:** A new `run.ts` `refresh` mode reads prior state from the DB (the previous run), runs the existing deterministic `buildSitrep` + `shouldAssess` gate, assesses only on genuine change, and writes the DB only (no snapshot/dashboard/commit). The daily `full` mode is today's behavior (JSON prior, `since yesterday` digest, commit + Pages). Two decoupled cron schedules drive them. GDACS parsing captures the payload's real `datemodified`.

**Tech Stack:** TypeScript (ESM, `strict`), Next.js on Vercel, Drizzle + postgres-js (Neon/Postgres), Vitest. Core/scripts under tsx. GitHub Actions cron.

## Global Constraints

- **ESM import extensions:** every relative import ends in `.js` even for `.ts` sources.
- **Tests never hit the network, a real model, or a browser.** DB integration suites are gated with `describe.skipIf(!process.env.DATABASE_URL)`.
- **Rules decide; the LLM only describes (CLAUDE.md #2).** The assess-gate is deterministic (`shouldAssess`); the model never decides whether a run wakes up. Never overstate freshness (CLAUDE.md #5).
- **Modest token use:** the hourly path must make **zero** model calls on a quiet hour.
- **`buildSitrep` stays pure** — no network, no LLM, no ambient clock; the prior is injected. Reading the DB prior happens in `run.ts`, not the core.
- **The user-facing daily `since yesterday` digest and wording do not change.** The hourly DB comparison is used only as the internal assess-gate.
- **Deviations policy:** record departures in `implementation-notes.md` under **Deviations**.

---

### Task 1: GDACS `datemodified` → real source update time

Capture the GDACS payload's `datemodified` (a real last-modified stamp, distinct from `fromdate`) as `sourceUpdatedAt` with provenance `source`; fall back to the event time (`inferred`) when absent. Mirrors the USGS `updated` pattern.

**Files:**
- Modify: `src/feeds/gdacs.ts`
- Test: `test/gdacs-parse.test.ts` (append)
- Modify: `implementation-notes.md` (deviation)

**Interfaces:**
- Consumes: existing `parseGdacsDate` (offset-less → epoch ms) and the `Event` type's optional `sourceUpdatedAt?: number` / `updateProvenance?: "source" | "inferred"`.
- Produces: GDACS `Event`s now carry `sourceUpdatedAt` + `updateProvenance` (previously omitted → defaulted downstream).

- [ ] **Step 1: Write the failing tests**

Append to `test/gdacs-parse.test.ts` (self-contained — own inline feature factory, no dependency on existing helpers in the file):

```ts
import { describe, it, expect } from "vitest";
import { parseGdacs } from "../src/feeds/gdacs.js";

describe("GDACS datemodified → source update time", () => {
  const feature = (extra: Record<string, unknown>) => ({
    properties: {
      eventtype: "EQ", eventid: 1, name: "t", country: "X",
      fromdate: "2026-07-06T09:00:00", alertlevel: "Orange", ...extra,
    },
    geometry: { coordinates: [1, 2] },
  });

  it("uses datemodified as sourceUpdatedAt with provenance 'source'", () => {
    const [e] = parseGdacs({ features: [feature({ datemodified: "2026-07-06T12:09:48" })] });
    expect(e.updateProvenance).toBe("source");
    expect(e.sourceUpdatedAt).toBe(Date.UTC(2026, 6, 6, 12, 9, 48));
  });

  it("falls back to event time (inferred) when datemodified is absent", () => {
    const [e] = parseGdacs({ features: [feature({})] });
    expect(e.updateProvenance).toBe("inferred");
    expect(e.sourceUpdatedAt).toBe(Date.UTC(2026, 6, 6, 9, 0, 0)); // = fromdate/time
  });

  it("falls back to inferred when datemodified is unparseable", () => {
    const [e] = parseGdacs({ features: [feature({ datemodified: "not-a-date" })] });
    expect(e.updateProvenance).toBe("inferred");
    expect(e.sourceUpdatedAt).toBe(Date.UTC(2026, 6, 6, 9, 0, 0));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/gdacs-parse.test.ts`
Expected: FAIL — `updateProvenance`/`sourceUpdatedAt` are `undefined` on GDACS events today.

- [ ] **Step 3: Implement the capture**

In `src/feeds/gdacs.ts`:

(a) Add `datemodified` to the `GdacsFeature` properties interface (next to `fromdate?: unknown;`):

```ts
    fromdate?: unknown;
    datemodified?: unknown;
```

(b) In `parseFeature`, immediately after the existing `const time = parseGdacsDate(props.fromdate); if (time === undefined) return undefined;` lines, add:

```ts
  // GDACS `datemodified` is the real last-updated stamp (distinct from `fromdate`,
  // the event start). Use it as the source update time when present; else fall
  // back to the event time (inferred) — mirrors the USGS `updated` pattern.
  const modified = parseGdacsDate(props.datemodified);
  const sourceUpdatedAt = modified ?? time;
  const updateProvenance = modified !== undefined ? ("source" as const) : ("inferred" as const);
```

(c) In the returned event object, add the two fields right after `time,`:

```ts
    time,
    sourceUpdatedAt,
    updateProvenance,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/gdacs-parse.test.ts`
Expected: PASS (existing GDACS tests + the 3 new ones).

- [ ] **Step 5: Record the deviation**

In `implementation-notes.md`, under **Deviations**, add:

```markdown
- **2026-07-11 — GDACS `datemodified` captured as a real source update time
  (Slice 2).** GDACS `Event`s now set `sourceUpdatedAt` from the payload's
  `datemodified` (provenance `source`), falling back to the event time (`inferred`)
  when absent — closing the earlier "GDACS source-update-time is inferred" gap.
  ReliefWeb stays `inferred` (RSS exposes only `pubDate`; the real fix is the
  approved-API swap, ADR 0008).
```

- [ ] **Step 6: Commit**

```bash
git add src/feeds/gdacs.ts test/gdacs-parse.test.ts implementation-notes.md
git commit -m "feat(gdacs): capture datemodified as real source update time"
```

---

### Task 2: `run.ts` — `refresh` and `full` run modes

Split the single run into two modes. `full` (default, daily, manual) is today's behavior. `refresh` (hourly) reads the DB prior, assesses event-driven, and writes the DB only.

**Files:**
- Modify (full rewrite): `src/run.ts`
- Modify: `implementation-notes.md` (deviation)

**Interfaces:**
- Consumes: `buildSitrep(feedResults, prior, now)`, `shouldAssess(changeSummary, force)`, `fillAssessments(model, writer)` (async), `carryForwardAssessments(model, prior)`, `fillFootprints(model, source)`, `readPriorSnapshot`/`writeSnapshot`, `renderDashboard(model, geometryById, fetchStatus)`, and (dynamic) `getDb`/`closeDb`, `persistRun`, `lastFetchByFeed`, `latestSurfacedEvents`. Types `FeedResult`, `FetchStatus`, `SitrepModel` from `./types.js`.
- Produces: `SITREP_MODE` env contract (`refresh` | anything-else→`full`).

- [ ] **Step 1: Rewrite `src/run.ts`**

Replace the entire file with:

```ts
import { writeFileSync } from "node:fs";
import { fetchUsgs } from "./feeds/usgs.js";
import { fetchGdacs } from "./feeds/gdacs.js";
import { reliefWebSource } from "./feeds/reliefweb.js";
import { readPriorSnapshot, writeSnapshot } from "./snapshots.js";
import { buildSitrep } from "./core/buildSitrep.js";
import { claudeCliWriter, fillAssessments } from "./assessment/writer.js";
import { shouldAssess, carryForwardAssessments } from "./assessment/gate.js";
import { renderDashboard } from "./render/dashboard.js";
import { fillFootprints } from "./footprints/fill.js";
import { httpFootprintSource } from "./footprints/source.js";
import type { FeedResult, FetchStatus, SitrepModel } from "./types.js";

/**
 * One run of the agent (ADR 0010/0011). Two modes (Slice 2):
 *  - full    (default; daily 00:30 cron + manual): assess (gated vs yesterday's
 *            JSON snapshot) → DB + JSON snapshot + dashboard.html + (workflow
 *            commits & deploys Pages). Today's behavior.
 *  - refresh (hourly cron): read prior state from the DB (the previous run),
 *            assess event-driven (only when something changed since then), write
 *            the DB only. The live Vercel app renders fresh from the DB — no
 *            snapshot/dashboard/commit needed.
 *
 * Top-level guard: the core and adapters are built not to throw; an unforeseen
 * error here exits non-zero (so the scheduler notices) — never crash unhandled
 * or fail silently (CLAUDE.md #4).
 */

function logSurfaced(model: SitrepModel): void {
  const changes = model.changeSummary
    ? `; changes vs prior: ${model.changeSummary.new} new, ${model.changeSummary.revised} revised, ${model.changeSummary.withdrawn} possibly withdrawn`
    : "; no prior (first run — no change notes)";
  console.log(
    `surfaced ${model.surfaced.length} event(s)` +
      (model.degradation.length
        ? `; feeds unavailable: ${model.degradation.map((d) => d.feed).join(", ")}`
        : "") +
      changes,
  );
}

/** Daily / manual: JSON prior, gated assess, snapshot + dashboard + (Pages via workflow). */
async function fullRun(feedResults: FeedResult[], now: Date): Promise<void> {
  const prior = readPriorSnapshot("data", now);
  const model = buildSitrep(feedResults, prior, now);
  logSurfaced(model);

  const force = process.env.FORCE === "true";
  const assess = shouldAssess(model.changeSummary, force);
  console.log(
    assess
      ? "writing assessments (change detected, first run, or forced)"
      : "quiet run — carrying forward prior assessments (no model call)",
  );

  const { model: withFootprints, geometryById } = await fillFootprints(model, httpFootprintSource);
  const assessed = assess
    ? await fillAssessments(withFootprints, claudeCliWriter)
    : carryForwardAssessments(withFootprints, prior);

  // Snapshot FIRST — the JSON audit net (ADR 0006) must survive even if the DB
  // write below fails (sitrep.yml commits it with `if: always()`).
  writeSnapshot("data", now, assessed);

  // Per-feed fetch status for the dashboard's Data Sources panel: prefer the DB
  // (matches the Vercel route), fall back to this run's own results.
  let fetchStatus: FetchStatus | null = null;
  if (process.env.DATABASE_URL) {
    try {
      const { getDb, closeDb } = await import("./db/client.js");
      const { persistRun } = await import("./db/persist.js");
      const { lastFetchByFeed } = await import("./db/reader.js");
      try {
        const { inserted } = await persistRun(getDb(), assessed, feedResults, now, geometryById);
        console.log(`db: wrote ${inserted} new event version(s)`);
        fetchStatus = await lastFetchByFeed(getDb());
      } finally {
        await closeDb();
      }
    } catch (dbErr) {
      console.error(`db write failed (dashboard rendered from this run's results): ${String(dbErr)}`);
      process.exitCode = 1;
    }
  } else {
    console.log("db: DATABASE_URL unset — skipped DB write (snapshot-only run)");
  }
  if (!fetchStatus) {
    const okFeeds = feedResults.filter((f) => f.status === "ok").map((f) => f.feed);
    fetchStatus = {
      latestRunAt: now.getTime(),
      latestFeedsOk: okFeeds,
      lastOkByFeed: Object.fromEntries(okFeeds.map((f) => [f, now.getTime()])),
    };
  }

  // Render LAST, with the resolved status — always runs (the DB error above is
  // caught, not rethrown), so a DB blip degrades the panel rather than losing
  // the dashboard.
  writeFileSync("dashboard.html", renderDashboard(assessed, geometryById, fetchStatus), "utf8");
  console.log("wrote dashboard.html and data snapshot");
}

/** Hourly: DB prior (previous run), event-driven assess, DB write only. */
async function refreshRun(feedResults: FeedResult[], now: Date): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("SITREP_MODE=refresh requires DATABASE_URL — nothing to refresh; exiting non-zero.");
    process.exitCode = 1;
    return;
  }
  const { getDb, closeDb } = await import("./db/client.js");
  const { persistRun } = await import("./db/persist.js");
  const { latestSurfacedEvents } = await import("./db/reader.js");
  try {
    // Read the current DB latest BEFORE writing — that IS the previous run's state.
    const dbPrior = await latestSurfacedEvents(getDb());
    const priorModel: SitrepModel = {
      generatedAt: now.getTime(),
      surfaced: dbPrior,
      degradation: [],
      withdrawn: [],
      changeSummary: null,
    };

    const model = buildSitrep(feedResults, priorModel, now);
    logSurfaced(model);

    // Event-driven gate: assess only when something changed since the last run.
    // FORCE is ignored here — the hourly path is never a manual dispatch.
    const assess = shouldAssess(model.changeSummary, false);
    console.log(
      assess
        ? "refresh: change since last run — writing assessments"
        : "refresh: no change since last run — carrying forward (no model call)",
    );

    const { model: withFootprints, geometryById } = await fillFootprints(model, httpFootprintSource);
    const assessed = assess
      ? await fillAssessments(withFootprints, claudeCliWriter)
      : carryForwardAssessments(withFootprints, priorModel);

    const { inserted } = await persistRun(getDb(), assessed, feedResults, now, geometryById);
    console.log(`refresh: db wrote ${inserted} new event version(s)`);
  } finally {
    await closeDb();
  }
}

try {
  // Feeds are independent — poll concurrently; each returns a FeedResult (never
  // throws), so one feed being down never sinks the others (ADR 0008).
  const feedResults = await Promise.all([fetchUsgs(), fetchGdacs(), reliefWebSource.fetch()]);
  const now = new Date();

  if (process.env.SITREP_MODE === "refresh") {
    await refreshRun(feedResults, now);
  } else {
    await fullRun(feedResults, now);
  }
} catch (err) {
  console.error(`run failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
}
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck`
Expected: clean (this typechecks `src/run.ts`).

Run: `npm run build`
Expected: Next build succeeds.

- [ ] **Step 3: Verify the full suite still passes**

Run: `npm test`
Expected: green (DB suites skip without `DATABASE_URL`).

- [ ] **Step 4: Local refresh-mode smoke (event-driven gate, no model call)**

With the local DB up (`docker start hadr-pg`) and migrated, run refresh **twice** against a DB that already has state (run `full` once first if the DB is empty, or accept that the first refresh may assess):

```bash
# Second refresh with unchanged feeds must make NO model call:
DATABASE_URL=postgres://postgres:hadr@localhost:5432/hadr SITREP_MODE=refresh npx tsx src/run.ts
```
Expected in a quiet re-run: logs `refresh: no change since last run — carrying forward (no model call)` and `refresh: db wrote 0 new event version(s)`; NO `dashboard.html` written, no snapshot, no commit. (If the model would be called, `CLAUDE_CODE_OAUTH_TOKEN` must be set — avoid by ensuring a quiet re-run.) This is best-effort local verification; the orchestrator has no unit test by design.

- [ ] **Step 5: Record the deviation**

In `implementation-notes.md`, under **Deviations**, add:

```markdown
- **2026-07-11 — `run.ts` split into `full` and `refresh` modes; event-driven
  hourly assessment (Slice 2).** `SITREP_MODE=refresh` (hourly) reads prior state
  from the DB (the previous run), runs `buildSitrep` + the existing `shouldAssess`
  gate, assesses only on genuine change since the last run, and writes the DB only
  (no snapshot/dashboard/commit). `full` (default; daily/manual) is unchanged —
  JSON prior, `since yesterday` digest, snapshot + dashboard + Pages. The DB-derived
  change verdict is used only as the internal gate, never as user-facing notes.
```

- [ ] **Step 6: Commit**

```bash
git add src/run.ts implementation-notes.md
git commit -m "feat(run): refresh/full modes; event-driven hourly assessment"
```

---

### Task 3: `sitrep.yml` — two decoupled schedules

Add an hourly schedule (DB refresh only) alongside the daily one (full: commit + Pages). Pass `SITREP_MODE` and gate the commit + Pages steps to the daily run / manual dispatch.

**Files:**
- Modify: `.github/workflows/sitrep.yml`
- Modify: `implementation-notes.md` (deviation)

**Interfaces:**
- Consumes: the `SITREP_MODE` contract from Task 2 (`refresh` on hourly, `full` on daily/dispatch).

- [ ] **Step 1: Two cron schedules**

In `.github/workflows/sitrep.yml`, replace the `on:` block's schedule:

```yaml
on:
  workflow_dispatch: {}
  schedule:
    - cron: "30 1-23 * * *"   # hourly (01–23 UTC) — DB refresh only (Vercel live-fresh)
    - cron: "30 0 * * *"      # daily 00:30 UTC = 08:30 SGT — full: assess + commit + Pages
```

(Hours don't overlap — the hourly range excludes 0 — so exactly one schedule fires each hour and the `sitrep` concurrency group never double-fires.)

- [ ] **Step 2: Pass `SITREP_MODE` to the run step**

In the "Run sitrep" step's `env:` block, add the `SITREP_MODE` line (keep the existing `CLAUDE_CODE_OAUTH_TOKEN`, `FORCE`, `DATABASE_URL`):

```yaml
        env:
          CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          FORCE: ${{ github.event_name == 'workflow_dispatch' }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}   # Neon (ADR 0011 dual-write)
          SITREP_MODE: ${{ (github.event_name == 'workflow_dispatch' || github.event.schedule == '30 0 * * *') && 'full' || 'refresh' }}
        run: npm run sitrep
```

- [ ] **Step 3: Gate commit + Pages steps to daily / dispatch**

Add an `if:` to the four artifact steps so they run only on the daily schedule or a manual dispatch (not hourly).

The "Commit dashboard + snapshot to main" step keeps its `always()` (commit even when the sitrep step exited non-zero) but restricts to daily/dispatch — change its `if: always()` to:

```yaml
        if: ${{ always() && (github.event_name == 'workflow_dispatch' || github.event.schedule == '30 0 * * *') }}
```

The "Stage Pages artifact", `actions/upload-pages-artifact@v3`, and `actions/deploy-pages@v4` steps (which have no `if:` today) each get:

```yaml
        if: ${{ github.event_name == 'workflow_dispatch' || github.event.schedule == '30 0 * * *' }}
```

Leave the checkout / setup-node / `npm ci` / Claude CLI install / Run sitrep steps unconditional (they run every hour). Leave `environment: name: github-pages` and `concurrency` as-is.

- [ ] **Step 4: Validate the workflow YAML**

Run: `npx --yes js-yaml .github/workflows/sitrep.yml >/dev/null && echo "YAML OK"`
Expected: `YAML OK` (well-formed). Re-read the file and confirm: two crons; `SITREP_MODE` expression present; the four artifact steps carry the daily/dispatch `if:`; the run/setup steps do not.

- [ ] **Step 5: Record the deviation**

In `implementation-notes.md`, under **Deviations**, add:

```markdown
- **2026-07-11 — Decoupled cron cadence (Slice 2).** `sitrep.yml` now runs hourly
  (`30 1-23`, `SITREP_MODE=refresh` — DB only, Vercel live-fresh) and daily
  (`30 0`, `SITREP_MODE=full` — assess + commit dashboard/snapshot + deploy Pages).
  The commit + Pages steps are gated to the daily run / manual dispatch, so `main`
  gets ~1 commit/day while the live app refreshes hourly. Supersedes the single
  daily schedule.
```

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/sitrep.yml implementation-notes.md
git commit -m "ci(sitrep): decoupled hourly refresh + daily full cadence"
```

---

## Self-Review

**1. Spec coverage**
- Hourly ingestion → DB (Vercel live-fresh) → Task 3 (hourly cron) + Task 2 (refresh mode DB write). ✓
- GDACS real `datemodified` (`source`), fallback `inferred` → Task 1. ✓
- ReliefWeb unchanged (inferred) → no task touches it (explicit). ✓
- Event-driven assessment gated on change-vs-previous-run from the DB → Task 2 (`refreshRun`: DB prior → `buildSitrep` → `shouldAssess(false)`). ✓
- Zero model calls on a quiet hour → Task 2 (`shouldAssess` false → `carryForwardAssessments`) + verified in Task 2 Step 4. ✓
- New event assessed the hour it appears → Task 2 (`new > 0` → `shouldAssess` true → `fillAssessments`). ✓
- Daily `full` unchanged incl. snapshot-first ordering + fetchStatus render → Task 2 `fullRun`. ✓
- Decoupled commit/Pages (daily only) → Task 3 Step 3. ✓
- `since yesterday` digest untouched; JSON/Pages not removed → no task changes change-detection copy or removes snapshots. ✓
- Deviations recorded → Task 1/2/3 Step 5/5/5. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code (full `run.ts`, exact GDACS edits, exact YAML). ✓

**3. Type consistency:** `SITREP_MODE` produced in Task 3 (`'full'`/`'refresh'`) is consumed in Task 2 (`=== "refresh"`). `refreshRun`/`fullRun` take `(feedResults: FeedResult[], now: Date)` consistently. `priorModel` is a full `SitrepModel` (`generatedAt`, `surfaced`, `degradation: []`, `withdrawn: []`, `changeSummary: null`) — matches what `buildSitrep` and `carryForwardAssessments` read (`prior.surfaced`). `fetchStatus` object matches `FetchStatus { latestRunAt, latestFeedsOk, lastOkByFeed }`. GDACS `sourceUpdatedAt`/`updateProvenance` match the `Event` optional fields consumed by `surfacedEventToRow`. ✓
