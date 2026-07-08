# ADR 0006 — Persistence via dated JSON snapshots in the repo, no database

- Status: Accepted
- Date: 2026-07-08

## Context

The agent needs run-to-run memory to (a) report "what changed since yesterday"
(ADR 0009 / event-revision handling), and (b) remember prior events for duplicate
flagging (ADR 0007). A full database adds operational overhead disproportionate to
a daily, single-writer, low-volume job.

## Decision

Persist each run's surfaced events as a **dated JSON snapshot** committed to the
repo (e.g. `data/YYYY-MM-DD.json`). No database. The scheduled workflow (ADR 0002)
reads the previous snapshot, writes the new one, and commits it.

## Consequences

- Zero infrastructure; state travels with the repo.
- Git history is a free, human-readable audit trail of what was reported each day.
- "Changed since yesterday" and duplicate memory are simple file diffs.
- Not suitable for high write frequency or concurrent writers — fine for one daily
  run.
- Repo grows slowly over time; acceptable, prunable later.
