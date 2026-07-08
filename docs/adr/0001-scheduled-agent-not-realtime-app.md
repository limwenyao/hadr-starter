# ADR 0001 — Scheduled unattended agent, not a realtime interactive app

- Status: Accepted
- Date: 2026-07-08

## Context

The initial idea (`REQS.md`) described an interactive web map with a live,
constantly-updating alerts side-panel — implying someone watching a screen, push
updates (WebSockets/SSE), and a running server. The repository `README.md`,
however, describes a different product: an agent that runs unattended on a schedule
and publishes a **daily 08:30 SGT situation report** to `dashboard.html`, "staying
quiet when nothing has changed." These are materially different systems.

The user chose to **follow the README**.

## Decision

Build a **scheduled, unattended agent** that regenerates a static daily situation
dashboard. There is **no realtime push, no live server, and no human watching a
live stream**. The output is a prepared brief read once each morning.

## Consequences

- No WebSocket/SSE/streaming infrastructure; no always-on backend to operate.
- Freshness is bounded by the schedule (once daily), which is acceptable for the
  duty-officer workflow.
- "Realtime" language from `REQS.md` is explicitly superseded and should not leak
  back into later docs.
- Enables cheap, reliable hosting (see ADR 0002) and static output (ADR 0005).
