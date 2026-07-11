# Slice 2 — Hourly freshness — design

- **Date:** 2026-07-11
- **Status:** Approved (brainstorm), ready for implementation planning
- **Related:** ADR 0011 (hosted backend / Next.js on Vercel), ADR 0010 (slice order),
  ADR 0008 (graceful degradation), ADR 0009 (change detection), `CLAUDE.md`
  (rules decide / LLM only describes; never overstate freshness; modest tokens).
  Builds directly on the staleness UI (PR #15) and the Data Sources tab (PR #17).

## 1. Context & motivation

The agent runs **once a day** (`sitrep.yml` cron `30 0 * * *`). Two consequences the
freshness features already shipped now bump against:

1. **Freshness bands read yellow/orange most of the day.** The event cards' and Data
   Sources tab's `Updated: ~x ago` bands (green `<60m`, yellow `<24h`, orange `≥24h`)
   only flash green right after the daily run; by mid-afternoon everything is yellow.
2. **Only USGS has a real update time.** USGS captures `properties.updated`
   (provenance `source`); GDACS and ReliefWeb fall back to event time (`inferred`,
   shown as a muted `(approx)`).

Slice 2 makes the data fresh **hourly** and gives **GDACS** a real update time. The
live Vercel app renders from the DB on every request (`app/route.ts`,
`force-dynamic`), so **hourly DB writes make it fresh within the hour with no git
commit** — the commit-to-`main` + GitHub Pages deploy is a separate, legacy path.

## 2. Goals / non-goals

**Goals**
- Ingest **hourly** so the DB (and thus the live Vercel dashboard) is fresh within the
  hour.
- Capture **GDACS**'s real `datemodified` as `sourceUpdatedAt` (provenance `source`).
- Keep model/token use **modest**: assess only when a genuinely new or materially
  changed event appears since the previous run (event-driven), not every hour.
- Give a genuinely new/escalated event its **LLM narrative the hour it appears**.

**Non-goals (YAGNI / other slices)**
- **Do not** migrate the user-facing `since yesterday` change digest off the daily
  JSON snapshot, and do not change its wording. The hourly DB comparison is used
  **only** as the internal assess-gate (see §5), never rendered as "since last hour".
- **Do not** remove JSON snapshots or the GitHub Pages path (eventual decom is a
  separate future slice). Slice 2 only avoids *deepening* reliance on them.
- No DB retention/pruning; no ReliefWeb real update-time (needs the approved API —
  ADR 0008; tracked follow-up).

## 3. Cadence — two decoupled schedules (`.github/workflows/sitrep.yml`)

| Schedule | Hours | `SITREP_MODE` | Does |
|---|---|---|---|
| `30 1-23 * * *` | 01–23 UTC | `refresh` | fetch → write DB only (Vercel fresh) |
| `30 0 * * *` | 00 UTC | `full` | today's behavior: assess (gated) → DB **+ snapshot + dashboard + commit + Pages** |

- The hourly schedule skips hour 0, so exactly one schedule fires each hour and the
  `sitrep` concurrency group never double-fires.
- The **commit + Pages** workflow steps gate on
  `github.event.schedule == '30 0 * * *' || github.event_name == 'workflow_dispatch'`.
- The run step passes `SITREP_MODE`:
  `${{ (github.event.schedule == '30 0 * * *' || github.event_name == 'workflow_dispatch') && 'full' || 'refresh' }}`.
  `DATABASE_URL` stays set for both (already a repo secret).
- **Local/manual `npm run sitrep` defaults to `full`** — unchanged for humans and for
  a `workflow_dispatch`.

## 4. `run.ts` run modes

Both modes share one pipeline — fetch feeds → fill footprints → `buildSitrep` →
(assess-or-carry-forward) → `persistRun`. Keep the shared steps DRY (extract a helper
if it reads cleanly); the mode only selects the **prior source** and whether
**artifacts** are written.

```
const mode = process.env.SITREP_MODE === "refresh" ? "refresh" : "full";
```

### full mode (daily / manual) — unchanged behavior
- prior = `readPriorSnapshot("data", now)` (JSON, yesterday) — drives the user-facing
  `since yesterday` digest.
- `model = buildSitrep(feeds, prior, now)`.
- `shouldAssess(model.changeSummary, force) ? fillAssessments(...) : carryForwardAssessments(model, prior)`.
- Snapshot FIRST, then the DB block (persist + `lastFetchByFeed` for the rendered
  `fetchStatus`), then render `dashboard.html` LAST (the resilient ordering from
  PR #17). Workflow commits + deploys Pages.

### refresh mode (hourly) — new, event-driven
- Requires `DATABASE_URL`. Read the **DB prior BEFORE persisting** — the current
  latest state *is* the previous run's state:
  `const dbPrior = await latestSurfacedEvents(getDb());` (rows carry `assessment`).
  Wrap it as a `SitrepModel`:
  `const priorModel = { generatedAt: <any>, surfaced: dbPrior, degradation: [], withdrawn: [], changeSummary: null };`
- `model = buildSitrep(feeds, priorModel, now)` — deterministic surfaced set with
  fresh timestamps; change-detection runs against the last run.
- **Event-driven gate (reuses the existing `shouldAssess`):**
  - `shouldAssess(model.changeSummary, /*force*/ false)` → **true** when there is a
    new / materially-revised / withdrawn event since the last run → `fillAssessments`
    (one batched model call for the surfaced set, as daily).
  - else → `carryForwardAssessments(model, priorModel)` (copy existing prose from the
    DB by `(feed, feedEventId)`; **no model call**).
- `await persistRun(getDb(), assessed, feeds, now, geometryById)`.
- **No snapshot, no `dashboard.html`, no commit, no Pages.** The DB-derived
  `changeSummary`/`withdrawn` are used **only** for the gate — never rendered.
- If `SITREP_MODE=refresh` but `DATABASE_URL` is unset (shouldn't happen in CI): log a
  clear message and exit non-zero without pretending to succeed.

**Correctness the gate relies on:** `buildSitrep` already excludes events from an
**unavailable** feed from withdrawal flagging (`changes.ts` — `!unavailableFeeds.has`),
so a one-run feed blip does **not** manufacture a "withdrawn" and does **not**
false-trip the gate (CLAUDE.md #5). Events aging out past `FEED_WINDOW_MS` are also
not flagged. So the gate fires on genuine change only.

### Empty-DB first run
`dbPrior === []` → `priorModel.surfaced` empty → every current event is `new` →
gate fires → assess. Correct (populates prose on the first populated run). Pass an
empty `priorModel`, not `null`.

## 5. Model-call / token profile

- Quiet hour (nothing new since last run) → **0 model calls** (carry-forward).
- Hour with a genuinely new/escalated event → **1 batched model call** (same call the
  daily run makes). Real HADR events don't arrive hourly, so this is only modestly
  above one/day and is self-limiting by the gate — honoring "modest token use"
  (CLAUDE.md). The daily `full` run assesses as today.

## 6. Feed adapters

- **GDACS** (`src/feeds/gdacs.ts`): add `datemodified` to the parsed properties; parse
  it with the existing `parseGdacsDate` (handles the offset-less format). Set
  `sourceUpdatedAt = datemodified` + `updateProvenance = "source"` when valid, else
  fall back to the event `time` + `"inferred"` — mirroring the USGS `hasUpdated`
  pattern. (Currently GDACS sets neither, so it defaults to `inferred` downstream.)
- **ReliefWeb** (`src/feeds/reliefweb.ts`): **unchanged** — stays `inferred`/`(approx)`.
  RSS exposes only `<pubDate>` (no distinct last-updated); the real fix is the
  approved-API swap (ADR 0008), tracked separately.
- **USGS**: unchanged.

## 7. Payoff & what does NOT change

**Payoff:** hourly refresh + GDACS `datemodified` → event-card and Data Sources
freshness bands go **green when actually fresh**; GDACS drops `(approx)`; a new
event gets prose within the hour; the live Vercel app is at most ~1h stale.

**Unchanged:** the daily committed dashboard's `since yesterday` digest and wording;
JSON snapshots (daily, audit net) and the Pages path; change-detection semantics for
the user-facing digest; DB schema.

## 8. Accepted trade-offs / edge cases

- An event first appearing intraday is assessed **that hour** (gate fires on `new`),
  so the earlier "no prose until morning" gap is **removed**.
- At the daily boundary the `full` run may re-assess (its JSON prior is yesterday, so
  an event new-since-yesterday still triggers a daily assess) — harmless; refreshes
  the committed digest.
- Feed politeness: 3 feeds × 24 runs/day = 72 fetches/day, one request each (30s
  timeout) — within ADR 0008's "poll politely".

## 9. Testing (`npm test`, Vitest; no network / model / browser)

- **GDACS parse unit tests** (`test/gdacs-parse.test.ts`): `datemodified` present and
  valid → `sourceUpdatedAt` = it, `updateProvenance = "source"`; absent/invalid →
  `sourceUpdatedAt` falls back to `time`, `updateProvenance = "inferred"`. Use the
  existing fixture (which has `datemodified`) + an inline no-`datemodified` case.
- **Carry-forward prior wrapper**: extract the "wrap `SurfacedEvent[]` as a
  carry-forward `SitrepModel` prior" step into a small pure helper and unit-test that
  `carryForwardAssessments` re-attaches prose by `(feed, feedEventId)` and that a new
  event (absent from the prior) gets none.
- **Gate behavior** is already covered by existing `gate`/`changes` tests; add a case
  asserting that with a non-null prior and zero new/revised/withdrawn, `shouldAssess`
  is false (quiet hour → no model call) — if not already covered.
- Existing change-detection / daily-path tests unchanged.
- `sitrep.yml` has no unit test — verify by reading + a `workflow_dispatch` trial and
  a manual `SITREP_MODE=refresh` local run against the Docker Postgres.

## 10. Decisions & deviations (record in `implementation-notes.md`)

- **Decoupled two-schedule cadence + `run.ts` run modes** (`refresh`/`full`) — hourly
  ingestion to the DB (Vercel live-fresh), daily commit/Pages. Supersedes the single
  daily cron.
- **Event-driven hourly assessment** gated on change-vs-previous-run read from the
  **DB** (not the JSON snapshot) — begins migrating change-detection off JSON (aligns
  with the eventual JSON/Pages decom) while leaving the user-facing daily `since
  yesterday` digest on the JSON snapshot.
- **GDACS `datemodified` captured** as a real `source` update time — closes the prior
  "GDACS update-time inferred" gap.
- **ReliefWeb remains `inferred`** (RSS limitation; API swap tracked).

## 11. Files touched (summary)

| File | Change |
|---|---|
| `.github/workflows/sitrep.yml` | two `schedule` crons; `SITREP_MODE` env; gate commit + Pages steps to the daily run / dispatch |
| `src/run.ts` | `refresh` vs `full` modes; refresh reads DB prior, event-driven gate, DB-only (no artifacts) |
| `src/feeds/gdacs.ts` | parse `datemodified` → `sourceUpdatedAt` (`source`), fallback `inferred` |
| `src/feeds/gdacs.ts` (helper) or `src/core/*` | small pure helper to wrap `SurfacedEvent[]` as a carry-forward prior (testable) |
| `test/gdacs-parse.test.ts` | `datemodified` source/inferred cases |
| `test/*` | carry-forward-wrapper unit test; quiet-hour gate case if missing |
| `implementation-notes.md` | deviations (§10) |

## 12. Verification

- `npm test` green, `npm run typecheck` clean, `npm run build` succeeds.
- `SITREP_MODE=refresh DATABASE_URL=<docker> npm run sitrep` locally: writes DB, no
  `dashboard.html`/snapshot/commit; a quiet re-run makes no model call; introducing a
  new event triggers one assessment.
- `workflow_dispatch` trial of `sitrep.yml` runs `full` (commits + Pages) as today.
- Live Vercel app reflects DB changes within the hour after a real hourly run.
