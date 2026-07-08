# CONTEXT.md — Shared language for HADR Monitor

This file defines the terms, actors, and concepts everyone (human and agent) must
use consistently. It is the vocabulary the PRD, shaping docs, and code all draw on.

Product in one line: **an unattended agent that watches three disaster feeds, filters
them to what matters, and publishes a prioritised daily situation dashboard for a
duty officer to review each morning.**

---

## Actors

- **Duty officer** — the primary user. Monitors the dashboard once each morning,
  uses it to understand overnight disaster activity, and (outside v1) produces a
  report to send up to supervisors for guidance. Not watching a live screen — reads
  a prepared brief.
- **Supervisor** — recipient of the duty officer's onward report. Not a direct user
  of the system in v1 (the report hand-off is out of scope for v1).
- **The agent** — the unattended automation that runs on a schedule, pulls feeds,
  filters, assesses, and renders the dashboard. Combines deterministic rules with an
  LLM step (see *assessment*).

## Core domain terms

- **HADR** — Humanitarian Assistance & Disaster Response. The problem domain.
- **Feed** — an external source of disaster data. Exactly three in scope:
  - **GDACS** — Global Disaster Alert & Coordination System (EU/UN). Multi-hazard
    (earthquake, cyclone, flood, volcano, drought, wildfire). GeoJSON points. Each
    event carries a colour-coded **alert level**.
  - **USGS** — US Geological Survey real-time earthquake feed. GeoJSON points
    (lon, lat, depth), regenerated every minute. Carries `mag`, `sig`, and a
    PAGER `alert`.
  - **ReliefWeb** — UN OCHA curated humanitarian disasters. Slower, human-curated
    ("appears once humans decide it matters"). Consumed via **RSS** in v1 (the API
    needs a pre-approved `appname`). Country-level only — **no coordinates**.
- **Event** — a single disaster occurrence as reported by one feed (one GeoJSON
  feature or one RSS item). In v1 the same physical disaster reported by two feeds
  is **two events** (feeds are treated independently; see *duplicate flag*).
- **Alert level (GDACS)** — GDACS's own colour rating: **Green / Orange / Red**
  (plus a numeric `alertscore`). Green = routine; Orange/Red = coordination-worthy.
- **PAGER alert (USGS)** — USGS's `alert` field: null / green / yellow / orange /
  red. An **impact** estimate (expected casualties/losses), distinct from magnitude
  (size). Used to promote impactful mid-magnitude quakes.
- **`sig` (USGS)** — a composite significance score (magnitude + felt reports +
  estimated impact).
- **GLIDE** — a global disaster identifier (e.g. `EQ-2026-000093-VEN`) used by
  ReliefWeb; a potential future key for cross-feed correlation (not used in v1).

## Filtering & prioritisation terms

- **Noise floor** — the threshold below which events are dropped as not worth
  surfacing. v1 is **conservative** (loud): GDACS Orange+Red · USGS M≥4.5 · all
  ReliefWeb.
- **Surfaced event** — an event that passes the noise floor and appears in the
  output.
- **Priority tier** — the unified severity ranking applied across all feeds so that
  "more severe = more visible". Three tiers:
  - 🔴 **CRITICAL** — GDACS Red · USGS M≥6.5 **or** PAGER alert orange/red.
  - 🟠 **HIGH** — GDACS Orange · USGS M5.5–6.4 · **all** ReliefWeb items.
  - 🟡 **MODERATE** — USGS M4.5–5.4.
- **Duplicate flag** — a non-destructive note marking events likely to be the same
  physical disaster (same hazard type, close in time and space). v1 flags; it does
  **not** merge them into one event.

## Agent-behaviour terms

- **Filtering** — deterministic, rule-based selection of surfaced events by the
  noise floor and tier rules. Auditable, cheap, predictable.
- **Assessment** — the **LLM-written** narrative for a surfaced event: *what
  happened, where, how bad, who is affected.* Full prose for Critical/High, terser
  for Moderate.
- **Run** — one execution of the agent: pull → filter → assess → snapshot → render.
- **Situation report / brief / dashboard** — used interchangeably for the output:
  the prioritised `dashboard.html` produced each run.
- **Graceful degradation** — if a feed is unavailable (down, rate-limited, not yet
  approved), the run continues on the remaining feeds and the brief **explicitly
  states** which feed was unavailable. Never fails silently; never crashes the run.

## Output & infrastructure terms

- **`dashboard.html`** — the single static output page, rendered client-side.
  Two coordinated views of the same surfaced events:
  - **Priority view** — the ranked tier list (Critical → High → Moderate).
  - **Spatial view** — a keyless interactive **map** (MapLibre/Leaflet) with
    severity-coloured **pins**; clicking a pin opens a **detail card** (the same
    card the list uses). ReliefWeb events appear in the list only (no coordinates).
- **Detail card** — the per-event UI element showing feed, tier, location, key
  metrics, and the agent's assessment.
- **Snapshot** — a dated JSON file (e.g. `data/YYYY-MM-DD.json`) of a run's surfaced
  events, committed to the repo. Provides run-to-run memory ("what changed since
  yesterday"), duplicate memory, and a git-history audit trail. No database.
- **Schedule** — the agent runs **once daily at 08:30 SGT** via **GitHub Actions
  cron**, unattended.

## Cadence & scope reference

- **Cadence** — once daily, 08:30 SGT. No intra-day/breaking updates in v1.
- **Trust priority** — the cardinal rule: **never miss a major event** (false
  negatives are the worst failure); secondarily, never overstate severity.
- **v1 vertical slice** — USGS → filter → LLM assessment → render `dashboard.html`
  → one manual run. Then add GDACS, ReliefWeb, map, priority styling, scheduling.
- **Out of scope (v1)** — report/PDF export, cross-feed *merging*, intra-day
  updates, ReliefWeb API/appname, historical analytics, auth, external
  notifications, true GeoPDF/GIS output, ReliefWeb map pins.

## Terminology discipline

- Say **"surfaced event"** for something that passed the filter; **"event"** alone
  may or may not have passed.
- Say **"priority tier"** (Critical/High/Moderate) for our unified ranking; say
  **"alert level"** only for GDACS's own colours and **"PAGER alert"** only for
  USGS's impact field. Do not conflate them.
- **"The agent"** = the whole automation. **"Assessment"** = only the LLM-written
  narrative part.
