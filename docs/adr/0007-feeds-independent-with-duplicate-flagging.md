# ADR 0007 — Feeds treated independently, duplicates flagged not merged

- Status: Accepted
- Date: 2026-07-08

## Context

The same physical disaster can appear in all three feeds under different
identifiers — the feed docs call this out explicitly (GDACS earthquakes often
originate from NEIC, the same agency behind USGS; ReliefWeb describes events USGS
and GDACS reported days earlier under different IDs). True cross-feed correlation
(deciding two records are the same event) is a hard problem: no shared key, timing
and location offsets, and revised data.

## Decision

For v1, **treat each feed independently** — one feed record = one event. Detect
**likely duplicates** heuristically (same hazard type + close in time + close in
space) and **flag them with a note**; do **not** merge them into a single event.
Full correlation/merging is deferred to a later spike.

## Consequences

- v1 stays simple and predictable; no fragile merge logic in the critical path.
- The duty officer may see the same disaster represented more than once, but
  duplicates are labelled rather than silently multiplied or silently dropped.
- ReliefWeb's GLIDE codes remain available as a future correlation key.
- Merging, when built, can reuse the duplicate-flag heuristic as its foundation.
