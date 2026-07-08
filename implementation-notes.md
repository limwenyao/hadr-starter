# Implementation notes

Kept by the agent, reviewed by you. One entry per working block.

## Decisions

- **2026-07-08 — v1 slice complete: first manual run.** `npm run sitrep`
  fetched live USGS data, filtered/tiered deterministically, wrote assessments
  via `claude -p`, and rendered `dashboard.html` (priority view only; map,
  other feeds, snapshots, and scheduling are later slices per ADR 0010).

## Open questions

## Deviations

<!-- Anything built that departs from the PRD or CLAUDE.md is recorded here,
     with the reason. An undocumented deviation is a bug. -->

- **2026-07-08 — PAGER-critical events bypass the magnitude noise floor.**
  ADR 0004 literally reads "noise floor: USGS M ≥ 4.5" and separately "CRITICAL:
  PAGER orange/red". A PAGER-red M4.2 quake would satisfy the tier rule but fail
  the floor. Resolved in favour of the cardinal rule (never miss a major event):
  `passesNoiseFloor` surfaces any USGS event with PAGER orange/red regardless of
  magnitude. Green/yellow PAGER does not bypass the floor.
