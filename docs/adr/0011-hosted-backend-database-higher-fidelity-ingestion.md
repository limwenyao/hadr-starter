# ADR 0011 — Hosted backend, database, and higher-fidelity ingestion

- Status: Accepted
- Date: 2026-07-09
- Supersedes: ADR 0002 (cadence + persistence mechanism), ADR 0005 (static/no-backend
  delivery), ADR 0006 (JSON-snapshots-only persistence). Amends ADR 0001 (see below).

## Context

v1 shipped as a scheduled agent producing a single static `dashboard.html`, backed by
dated JSON snapshots committed to the repo, on a once-daily GitHub Actions cron (ADRs
0001/0002/0005/0006). That architecture proved the pipeline end-to-end and remains
correct for a daily brief.

Two product needs now outgrow it:

1. **Higher fidelity.** A once-daily brief has a ~23h worst-case blind spot (ADR 0010).
   We want hourly (or better) ingestion.
2. **Temporal features.** The duty officer wants to explore how events evolved over
   time — a time-slider replaying events as the *upstream sources* reported them, plus
   trending. That requires queryable historical state, keyed on **source time** (when
   the source reported/updated an event), not on when our cron happened to poll. Dated
   JSON snapshots keyed on run time cannot answer these queries well.

A hosted app with a database and a backend is the proportionate way to serve both. The
migration is sequenced as vertical slices (see the Slice 1 spec) so each step is
independently demoable, mirroring ADR 0010's approach.

## Decision

Re-platform the delivery and persistence layers while **preserving the deterministic
core** (`buildSitrep`, ADR 0003/0004; CLAUDE.md #1) untouched:

- **Hosting/app:** a **Next.js app deployed on Vercel** (server-side rendering + API
  routes). Supersedes the static `dashboard.html` of ADR 0005. The **keyless map**
  (MapLibre, ADR 0005) is retained.
- **Database:** a **hosted Postgres (Neon via Vercel)**, accessed through **Drizzle**.
  Supersedes ADR 0006's no-database decision. Events are stored **bitemporally** — one
  append-only row per distinct *upstream* version, unique on
  `(feed, feed_event_id, source_updated_at)` — so temporal queries filter on source
  time, independent of ingestion cadence. (Schema in the Slice 1 spec.)
- **Ingestion:** stays on **GitHub Actions cron** (the Node ingestion + `claude -p`
  runner is unchanged), but writes surfaced events to Postgres instead of committing
  JSON as the primary store, and fires **hourly** rather than daily. Supersedes ADR
  0002's cadence and its "commit snapshots as the store" mechanism; the GitHub Actions
  cron mechanism itself is retained.
- **Snapshots (transitional):** dated JSON snapshots keep being committed alongside the
  DB during the migration, preserving ADR 0006's git audit trail as a safety net. They
  will be dropped by a follow-up ADR once the DB is trusted in production.

### Relationship to ADR 0001

ADR 0001's core stance — a **scheduled, unattended ingestion agent, not a realtime
push app** — is **reaffirmed**: there is still no WebSocket/SSE push and no human
watching a live stream; the frontend reads *stored* state on request. What is
superseded is ADR 0001's *consequence* that this implies "no always-on backend" and
"static output": a Vercel-hosted backend now serves pages and an API on demand.

## Consequences

- Introduces operational surface v1 avoided: a hosted DB, a deployed app, and secrets
  (DB connection string) — accepted as proportionate to the temporal features.
- **Introduces a build step** (Next.js), superseding CLAUDE.md's "run TypeScript
  directly with tsx, no build step" convention for the app. The pure core and its
  scripts can still run under tsx; CLAUDE.md must be updated to record this.
- Ingestion writing to a network DB can fail independently of feed fetches; the run
  must degrade gracefully and never crash (CLAUDE.md #4), and the last good DB state
  keeps serving.
- Temporal correctness depends on each feed exposing a usable update timestamp; where a
  feed's update clock is coarse or absent, the stored timestamp's provenance is marked
  and the UI does not overstate freshness (CLAUDE.md #5).
- Repo no longer grows unboundedly with snapshots once they are dropped; growth moves to
  the DB, managed by retention/pruning (a later slice).
