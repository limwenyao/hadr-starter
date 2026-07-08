# ADR 0004 — Conservative noise floor and three-tier unified priority

- Status: Accepted
- Date: 2026-07-08

## Context

The feeds are dominated by low-signal volume (USGS alone emits ~200 quakes/day,
mostly imperceptible). The output must suppress this noise while — per the cardinal
trust rule — **never missing a major event**. The three feeds use incompatible
severity scales (GDACS colours, USGS magnitude/impact, ReliefWeb none), yet the
duty officer needs a single ranking so that "more severe = more visible".

## Decision

**Noise floor (conservative / loud):**

- GDACS: **Orange + Red** (drop Green).
- USGS: **magnitude ≥ 4.5**.
- ReliefWeb: **all** curated items.

**Unified priority tiers** (applied across all feeds):

- 🔴 **CRITICAL** — GDACS Red · USGS M ≥ 6.5 **or** PAGER `alert` = orange/red.
- 🟠 **HIGH** — GDACS Orange · USGS M 5.5–6.4 · **all** ReliefWeb items.
- 🟡 **MODERATE** — USGS M 4.5–5.4.

Two deliberate judgement calls:

- **USGS is impact-aware:** a mid-magnitude quake with a red/orange PAGER impact
  rating is promoted to Critical, closing the "small quake under a dense city" gap
  without needing LLM judgement.
- **ReliefWeb defaults to High:** it has no magnitude and is already human-curated,
  so its presence alone warrants prominence.

## Consequences

- All Red/major events are captured, satisfying the recall requirement.
- The conservative stance accepts a longer brief and some false positives in
  exchange for not missing events — a trade the user explicitly chose.
- Thresholds are constants, easily tuned later without architectural change.
- The tier of every surfaced event is deterministic and auditable (ADR 0003).
