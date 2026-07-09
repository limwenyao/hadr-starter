# JSON snapshots + change detection slice — design

- Date: 2026-07-08
- Status: Approved (brainstorming)
- Slice: ADR 0006/0009 (ADR 0010 order: feeds ✓ → map ✓ → **snapshots** → schedule)

## Goal

Persist each run as a dated JSON snapshot committed to the repo (git = audit
trail, no database — ADR 0006), and wire the already-threaded `priorSnapshot`
argument of `buildSitrep` to detect **new / revised / withdrawn** events with
deterministic change notes (latest-state-with-change-notes — ADR 0009). The
change summary is the deterministic verdict the later scheduled slice's
"stay quiet when nothing changed" gate will read.

## Non-goals

- No cross-feed change tracking (feeds independent — ADR 0007).
- No git committing from the run itself (the scheduled workflow commits; manual
  for now).
- No snapshot pruning/compaction (ADR 0006: prunable later).

## Snapshot persistence — `src/snapshots.ts`

- **File = the assessed `SitrepModel`**, pretty-printed, at `data/YYYY-MM-DD.json`.
  Date is the **UTC date** of the injected `now` (08:30 SGT = 00:30 UTC, same
  calendar date). Written after `fillAssessments`, so each snapshot records what
  the brief actually said (audit trail).
- `readPriorSnapshot(dir, now): SitrepModel | null` — parses the **most recent
  snapshot dated strictly before today's UTC date**. Intraday re-runs therefore
  still compare against yesterday ("since yesterday" stays stable). Missing dir,
  no prior file, or corrupt JSON → `null` with a stderr warning; never a crash
  (CLAUDE.md #4).
- `writeSnapshot(dir, now, model)` — writes/overwrites today's file (latest
  state wins — ADR 0009). Creates `data/` if absent.
- File IO is unit-tested with temp dirs (no network/model/browser involved).

## Change detection — pure `src/core/changes.ts`, called inside `buildSitrep`

Identity: `(feed, feedEventId)`.

- **New**: in current, not in prior → `change: { kind: "new" }`. Applied only
  when a prior snapshot exists — on the first run nothing is flagged.
- **Revised (material)**: same identity and any of:
  - `|Δmag| ≥ MAG_REVISION_MIN` (thresholds.ts, **0.1** — sub-0.1 jitter would
    produce daily noise),
  - tier changed,
  - GDACS alert level changed.
  Note text is deterministic and precomputed, e.g.
  `"revised since yesterday: M 5.8 → M 5.1"`, `"tier raised: HIGH → CRITICAL"`,
  `"alert level: orange → red"` — multiple joined with "; ".
- **Withdrawn**: in prior, not in current, **and** still inside the feed's
  rolling visibility window (`FEED_WINDOW_MS`, **24 h** for USGS and GDACS —
  thresholds.ts). Without the guard, events naturally aging out of USGS's 24-h
  feed would be falsely reported withdrawn — overstatement, breaking the
  cardinal rule. Hedged wording:
  `"no longer listed by USGS since yesterday (possibly withdrawn): <title>"`.
  Withdrawn items are panel notes (like degradation notices), never map pins.

Model additions (`src/types.ts`):

- `SurfacedEvent.change?: { kind: "new" | "revised"; note?: string }`
- `SitrepModel.withdrawn: { feed: FeedName; feedEventId: string; note: string }[]`
- `SitrepModel.changeSummary: { new: number; revised: number; withdrawn: number } | null`
  — `null` when no prior snapshot existed (first run); the quiet-gate's input.

## Wiring

- `src/run.ts`: `readPriorSnapshot("data", now)` → `buildSitrep(feeds, prior, now)`
  → assess → render dashboard → `writeSnapshot("data", now, assessed)`. Console
  line includes the change summary.
- `src/render/viewModel.ts`: passes through `isNew`, `changeNote` per event and a
  `withdrawn` notes list + `changeSummary`; client renders a `NEW` chip, an amber
  revision note line on rows/cards, and a "Changes since yesterday" panel block
  (absent entirely on first runs).
- `src/assessment/writer.ts`: prompt includes the revision note (grounded
  narrative may mention it; the LLM still decides nothing).

## Testing

- `test/changes.test.ts`: new; revised by mag/tier/alert; jitter below
  MAG_REVISION_MIN not noted; withdrawn inside window; aged-out NOT withdrawn;
  prior-null flags nothing.
- `test/snapshots.test.ts` (temp dirs): write/read round-trip; picks latest
  strictly-before-today; ignores today's file; corrupt JSON → null; missing dir →
  null; write creates dir and overwrites.
- `test/build-sitrep.test.ts`: prior snapshot in → change notes/withdrawn out.
- `test/view-model.test.ts` + `test/render.test.ts`: payload carries the new
  fields; NEW chip / changes block markup pinned in client script.

## Judgment calls (approved)

1. `MAG_REVISION_MIN = 0.1` — named constant.
2. Withdrawn only within the 24-h feed window; hedged wording.
3. Snapshot stores the **assessed** model (audit of what was reported).
4. Intraday re-runs compare against yesterday, not the same morning's earlier run.

Recorded in `implementation-notes.md` Deviations as interpretations of ADR 0009.
