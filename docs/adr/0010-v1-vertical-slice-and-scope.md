# ADR 0010 — v1 vertical slice and scope boundary

- Status: Accepted
- Date: 2026-07-08

## Context

This is a time-boxed build (a 3-day workshop: Plan → Autonomy → Trust). Attempting
all three feeds, the map, scheduling, and priority styling at once risks never
proving the pipeline end-to-end. A thin vertical slice de-risks the architecture
before breadth is added.

## Decision

**v1 vertical slice (build first, end-to-end):**

    USGS → threshold filter → LLM assessment → render dashboard.html → one manual run

Then layer on, in order: GDACS, ReliefWeb (RSS), the interactive map + priority
styling, the JSON snapshots, and finally the 08:30 SGT scheduled workflow.

**Explicitly out of scope for v1:**

- Report / PDF export (and true GeoPDF / GIS output)
- Cross-feed event *merging* (duplicates are flagged only — ADR 0007)
- Intra-day / breaking updates (once daily only) — **planned for v2**: a more
  frequent cron that publishes when a Critical-tier event appears. Accepted v1
  trade-off is a ~23h worst-case latency on events occurring just after a run.
- ReliefWeb API / `appname` (RSS only — ADR 0008)
- Historical trend analytics
- Auth / login
- Notifications beyond the page itself
- ReliefWeb map pins (list-only — ADR 0005)

## Consequences

- The riskiest path (feed → filter → LLM → rendered page) is proven on one feed
  before breadth is added.
- Each subsequent addition is independently demoable.
- The scope list is the reference for "not now" — deferrals are recorded, not
  forgotten, and can be revisited post-v1.
