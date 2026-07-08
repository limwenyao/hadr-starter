# GDACS feed slice — design

- Date: 2026-07-08
- Status: Approved (brainstorming)
- Slice: second v1-breadth feed (ADR 0010 order: GDACS → ReliefWeb → map → snapshots → schedule)

## Goal

Add GDACS as a second feed behind the existing `buildSitrep` seam, and — because
GDACS is the first feed that can duplicate USGS (its earthquakes often originate
from NEIC, the same agency behind USGS) — add deterministic **duplicate flagging**
(ADR 0007: flag, never merge).

## Non-goals

- No merging/correlation of duplicates (flag only — ADR 0007).
- No change detection across runs (`episodeid` revisions) — that is the snapshots
  slice (ADR 0009/0010).
- No GDACS magnitude extraction from prose (see Judgment calls).
- No prompt-injection hardening (accepted v1 risk — see Risks).

## Adapter — `src/feeds/gdacs.ts` (mirrors `usgs.ts`)

- `parseGdacs(rawPayload): Event[]` — pure, skips malformed features, never throws.
- `fetchGdacs(): Promise<FeedResult>` — thin HTTP against the GeoJSON endpoint
  `https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP`, 30s timeout,
  polite user-agent; any failure → `{ feed: "GDACS", status: "unavailable", error }`
  (ADR 0008). Not unit-tested (no network in tests).

Field mapping (feed property → `Event`):

| Event field         | GDACS source                                             |
|---------------------|----------------------------------------------------------|
| `feed`              | `"GDACS"`                                                |
| `feedEventId`       | `String(eventid)` — stable event identity (ADR 0009)     |
| `hazardType`        | `eventtype` (EQ/TC/FL/VO/DR/WF), raw code                 |
| `title`             | `name`                                                   |
| `locationName`      | `country` (fallback `"location unknown"`)                |
| `coordinates`       | geometry `[lon, lat]` (no depth)                          |
| `time`              | `fromdate` parsed as **UTC** (see below), epoch ms       |
| `metrics.alertLevel`| `alertlevel` normalised to `green`/`orange`/`red`        |
| `metrics.mag`       | undefined (not extracted — see Judgment calls)           |
| `sourceUrl`         | `url.report`                                             |

**UTC correctness:** `fromdate` is `"2026-07-06T11:29:36"` with no offset. JS parses
an offset-less date-time as *local* time, which would misplace every GDACS event by
the host's timezone. Parse explicitly as UTC (append `Z`), then gate through
`isValidEventTime` (from `src/time.ts`) so a malformed date is skipped, never crashes.

## Types — `src/types.ts`

- `export type GdacsAlertLevel = "green" | "orange" | "red";`
- `metrics.alertLevel?: GdacsAlertLevel` — **distinct from `pagerAlert`**. Per
  CONTEXT.md, "alert level" is GDACS-only and "PAGER alert" is USGS-only; they are
  never conflated.
- `SurfacedEvent.duplicateOf?: { feed: FeedName; feedEventId: string; title: string }`
  — a flag/note pointing at the primary. Never a merge.

## Rules & thresholds (ADR 0004, verbatim)

In `src/thresholds.ts` (the single tunable place — CLAUDE.md #3):

- `GDACS_SURFACE_ALERTS = ["orange", "red"]` — Green is noise.
- `GDACS_CRITICAL_ALERT = "red"` — Orange → HIGH.
- `DUP_TIME_WINDOW_MS = 90 * 60_000` (±90 min).
- `DUP_DISTANCE_KM = 100`.

In `src/core/triage.ts` (deterministic, no model — ADR 0003):

- `passesNoiseFloor`: GDACS branch → `alertLevel ∈ GDACS_SURFACE_ALERTS`.
- `tierFor`: GDACS branch → red = CRITICAL, orange = HIGH.

## Duplicate flagging — `src/core/duplicates.ts` (pure)

`flagDuplicates(surfaced: SurfacedEvent[]): SurfacedEvent[]`, called inside
`buildSitrep` after the severity sort.

- **Predicate:** a pair is a likely duplicate iff **different feeds** + same
  `hazardType` + both have `coordinates` + `|Δtime| ≤ DUP_TIME_WINDOW_MS` +
  haversine distance `≤ DUP_DISTANCE_KM`.
- **Primary selection:** the list is already sorted most-severe-first; greedily,
  the first member of a cluster is the primary, later members receive
  `duplicateOf = {primary}`. Both remain in `surfaced` — flagged, never merged or
  dropped (CLAUDE.md #5). Events without coordinates never match, so they are never
  flagged and never crash the heuristic.

## Wiring & render

- `src/core/buildSitrep.ts`: parse dispatch extended via a `{ USGS: parseUsgs,
  GDACS: parseGdacs }` map; `flagDuplicates` applied after the sort.
- `src/run.ts`: fetch USGS + GDACS in parallel (`Promise.all`), pass both to
  `buildSitrep`. Top-level guard unchanged.
- `src/render/dashboard.ts`: alert-level badge (`alert red`), a hazard-type badge
  for non-EQ hazards, and a duplicate note (`Likely the same event as USGS — <title>`,
  escaped). Update the "feeds:" line to include GDACS.
- `src/assessment/writer.ts`: include `alertLevel`, `hazardType`, and the duplicate
  flag in the prompt so the narrative stays grounded.

## Testing (all offline, fixture-driven — CLAUDE.md test rules)

- `test/gdacs-parse.test.ts`: alert normalisation; UTC-date correctness; multi-hazard
  eventtype; skip malformed / bad-date / primitive features.
- `test/duplicates.test.ts`: haversine sanity; predicate true/false cases.
- `test/build-sitrep.test.ts` additions: GDACS floor (green dropped, orange/red
  surface); GDACS tiers (red CRITICAL, orange HIGH); a USGS+GDACS same-quake pair →
  both surface, secondary flagged `duplicateOf` primary; two same-feed nearby quakes →
  **not** flagged; no-coords event → never flagged.
- `test/render.test.ts` additions: alert badge; duplicate note rendered and escaped.

## Judgment calls (locked; all cheaply reversible)

1. **GDACS magnitude not extracted** — it lives only in `htmldescription` prose;
   parsing it is fragile and unnecessary since alert level drives GDACS tiering.
   `metrics.mag` stays undefined; within-tier sort leaves GDACS at `mag ?? 0`.
2. **Cross-feed-only duplicate flagging** — avoids mislabelling two genuinely
   distinct nearby quakes in the same feed; matches ADR 0007's NEIC rationale.
3. **Duplicate window ±90 min / 100 km** — conservative starting constants, tunable.

## Risks

- **Prompt-injection (debt #11):** feed-supplied `title`/`locationName`/`country`
  flow into the `claude -p` assessment prompt. Now live with a second feed. Kept as
  a **documented accepted v1 risk**; to be hardened before/with the model-call
  gating in the scheduled-workflow slice.

## Docs / deviations

No new ADR (0004/0007/0009 cover the decisions). Record in `implementation-notes.md`
under Deviations: GDACS-mag omission, cross-feed-only duplicate restriction, and the
deterministic primary-selection rule.
