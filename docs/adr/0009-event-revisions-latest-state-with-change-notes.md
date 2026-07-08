# ADR 0009 — Report latest state, note material changes since yesterday

- Status: Accepted
- Date: 2026-07-08

## Context

Events are revised after first publication: USGS records are `status: automatic`
and get magnitude/location corrections or are occasionally deleted; GDACS episodes
can change colour. A brief published yesterday can therefore disagree with today's
feed data for the same event.

## Decision

Each daily report reflects the **latest feed state at run time**. Where an event
that was reported previously has **materially changed** (severity/magnitude revised,
tier changed, or event withdrawn), the brief **notes the change** ("revised from
M5.8 to M5.1 since yesterday"). Comparison uses the prior JSON snapshot (ADR 0006).

## Consequences

- The duty officer always sees current data, not stale first estimates.
- Material corrections are surfaced rather than hidden, supporting trust.
- Requires a stable per-event identity within a feed across runs (feed's own id).
- Cross-feed change tracking is not attempted (feeds are independent — ADR 0007).
