# Implementation notes

Kept by the agent, reviewed by you. One entry per working block.

## Decisions

- **2026-07-08 — v1 slice complete: first manual run.** `npm run sitrep`
  fetched live USGS data, filtered/tiered deterministically, wrote assessments
  via `claude -p`, and rendered `dashboard.html` (priority view only; map,
  other feeds, snapshots, and scheduling are later slices per ADR 0010).

- **2026-07-08 — deferred-debt hardening block.** Cleared the pre-GDACS debt
  ledger. Real fixes: (a) out-of-range/NaN event times could throw `RangeError`
  in the renderer and the assessment prompt — added `src/time.ts`
  (`isValidEventTime` / safe `formatUtc`), a finite+range bound-check in the USGS
  parser (malformed time → feature skipped), routed all time formatting through
  `formatUtc`, and wrapped `run.ts` in a top-level try/catch (exit 1, no unhandled
  crash); (b) `fillAssessments` now returns a fresh object in the empty-surfaced
  case; (c) renderer tier-colour CSS now emits in severity order, not surfaced
  order. Plus characterization tests for parser defensive branches, mixed ok+down
  feeds, null-mag CRITICAL sort tie-break, the `parseAssessmentResponse`
  trailing-`]` fails-safe limitation, and hostile-input escaping
  (locationName / degradation reason / undefined assessment). 43 → 62 tests.

## Open questions

- **Prompt injection via feed text (accepted v1 risk; revisit before multi-feed).**
  Feed-supplied `title` / `locationName` are interpolated into the `claude -p`
  prompt in `buildAssessmentPrompt`. A hostile feed string could attempt to steer
  the assessment narrative. Accepted for v1 (USGS only, a reputable source).
  Before GDACS/ReliefWeb land (less-curated text), decide on a mitigation —
  delimiting/escaping feed text in the prompt, or instructing the model to treat
  the event block as untrusted data. Note: rules already decide inclusion/tier
  (ADR 0003/0004), so injection cannot change *what* surfaces — only the prose.

## Deviations

<!-- Anything built that departs from the PRD or CLAUDE.md is recorded here,
     with the reason. An undocumented deviation is a bug. -->

- **2026-07-08 — PAGER-critical events bypass the magnitude noise floor.**
  ADR 0004 literally reads "noise floor: USGS M ≥ 4.5" and separately "CRITICAL:
  PAGER orange/red". A PAGER-red M4.2 quake would satisfy the tier rule but fail
  the floor. Resolved in favour of the cardinal rule (never miss a major event):
  `passesNoiseFloor` surfaces any USGS event with PAGER orange/red regardless of
  magnitude. Green/yellow PAGER does not bypass the floor.

- **2026-07-08 — GDACS magnitude is not extracted.** GDACS carries magnitude only
  inside the `htmldescription` prose string, not a structured field. Parsing it is
  fragile and unnecessary: GDACS tiering is driven entirely by alert level (ADR
  0004), so `metrics.mag` stays undefined for GDACS. Consequence: within a tier the
  magnitude tie-break sorts GDACS events (mag → 0) after magnitude-bearing USGS
  events. Acceptable for v1; revisit if within-tier ordering matters.

- **2026-07-08 — Duplicate flagging is cross-feed only.** ADR 0007 says flag likely
  duplicates (same hazard + close time + close space). We additionally require the
  pair to come from *different* feeds, so two genuinely distinct nearby quakes in a
  single feed are never mislabelled as duplicates. Matches the ADR's rationale (the
  same physical event arriving via USGS and GDACS/NEIC). Window constants
  `DUP_TIME_WINDOW_MS` (±90 min) and `DUP_DISTANCE_KM` (100) live in `thresholds.ts`.

- **2026-07-08 — Duplicate primary selection is severity-order-first.** Within a
  duplicate cluster the primary (unflagged) event is the first in the
  already-severity-sorted list; later members carry `duplicateOf`. Both remain in
  `surfaced` — flagged, never merged or dropped (CLAUDE.md #5).

- **2026-07-08 — Prompt-injection remains an accepted v1 risk (now live).** Feed
  text (`title`, `locationName`/`country`) flows into the `claude -p` assessment
  prompt. With GDACS added, a second feed now contributes untrusted text. Left
  unhardened for v1 per the standing decision; to be addressed with the model-call
  gating in the scheduled-workflow slice (ADR 0010).
