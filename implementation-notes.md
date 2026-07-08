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
