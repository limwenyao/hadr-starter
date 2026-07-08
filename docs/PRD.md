# PRD — HADR Monitor (v1)

> An unattended **agent** that watches three disaster **feeds**, filters them to
> what matters, and publishes a prioritised daily **situation report** to
> `dashboard.html` for a **duty officer** to review each morning.

Vocabulary in this document is defined in `CONTEXT.md` and must be used
consistently. Decisions here are constrained by ADRs 0001–0010 (`docs/adr/`); this
PRD implements them, it does not re-open them.

---

## Problem Statement

A duty officer needs to understand overnight disaster activity before starting the
day, so they can (outside v1) brief a supervisor. The raw sources make this hard:

- Three feeds (**GDACS**, **USGS**, **ReliefWeb**) publish in incompatible shapes
  and on incompatible severity scales — GDACS colour alert levels, USGS
  magnitude/`sig`/PAGER impact, ReliefWeb curated prose with no magnitude and no
  coordinates.
- The volume is dominated by noise (USGS alone emits ~200 mostly-imperceptible
  quakes a day), so the signal — the handful of events worth coordinating on — is
  buried.
- There is no single ranking, so "how bad is this relative to that?" cannot be
  answered at a glance across feeds.
- Reading three raw feeds every morning is slow, error-prone, and easy to get
  wrong in the direction that matters most: **missing a major event**.

## Solution

An unattended agent runs once each morning (08:30 SGT) and, without anyone
watching a screen, produces a single prepared brief:

- It pulls all three feeds, drops routine noise with a conservative, auditable
  **noise floor**, and ranks every **surfaced event** on one unified three-tier
  **priority** scale (🔴 Critical / 🟠 High / 🟡 Moderate) so that *more severe =
  more visible*.
- For each surfaced event an LLM writes a grounded **assessment** — what happened,
  where, how bad, who is affected — full prose for Critical/High, terser for
  Moderate. The LLM only *describes*; it never decides inclusion or tier.
- The output is a single static `dashboard.html` with two coordinated views of the
  same surfaced events: a ranked **priority view** and an interactive keyless-map
  **spatial view** whose pins open the same **detail card** the list uses.
- It remembers the previous run via a committed JSON **snapshot**, so it can note
  what **changed since yesterday** and flag likely **duplicates** across feeds.
- If a feed is unavailable, the run **degrades gracefully**: it reports on the
  others and the brief explicitly states which feed was missing. It never fails
  silently and never crashes.

The duty officer opens one page each morning and trusts that nothing major was
silently dropped.

## User Stories

### Reading the morning brief (duty officer)

1. As a duty officer, I want to open a single `dashboard.html` each morning, so
   that I can understand overnight disaster activity without reading three raw
   feeds.
2. As a duty officer, I want surfaced events ranked with the most severe first, so
   that I see what matters most before anything else.
3. As a duty officer, I want each event colour-coded by priority tier (🔴/🟠/🟡),
   so that I can gauge severity at a glance.
4. As a duty officer, I want Critical and High events to carry a full narrative
   assessment, so that I understand what happened, where, how bad, and who is
   affected without opening the source.
5. As a duty officer, I want Moderate events shown more tersely (and/or
   collapsible), so that lower-signal items are present but do not crowd out the
   serious ones.
6. As a duty officer, I want each detail card to show the feed, tier, location, and
   key feed metrics (e.g. magnitude, alert level, PAGER alert), so that I can see
   the hard numbers behind the narrative.
7. As a duty officer, I want to know which feed each event came from, so that I can
   weigh the source when I brief my supervisor.
8. As a duty officer, I want the brief to state the date/time it was generated and
   the window it covers, so that I know how current it is.

### Spatial view (duty officer)

9. As a duty officer, I want an interactive map showing surfaced events as pins, so
   that I can see the geographic spread of overnight activity.
10. As a duty officer, I want map pins coloured by priority tier, so that the
    spatial view carries the same severity signal as the list.
11. As a duty officer, I want to click a pin and open the event's detail card, so
    that the map and the list give me the same information.
12. As a duty officer, I want the map to work without any API key or login, so that
    the brief always renders regardless of billing or credentials.
13. As a duty officer, I want ReliefWeb events (which have no coordinates) shown in
    the ranked list only and never as fabricated map pins, so that I never mistake
    an invented location for a real one.

### What is surfaced vs. suppressed (duty officer / the agent)

14. As a duty officer, I want routine noise (GDACS Green, USGS M<4.5) dropped
    before I ever see it, so that the brief stays readable.
15. As a duty officer, I want the noise floor to be conservative (loud), so that
    the system errs toward showing me too much rather than missing something.
16. As a duty officer, I want a mid-magnitude quake with a high PAGER impact rating
    promoted to Critical, so that a "small quake under a dense city" is not
    under-ranked by magnitude alone.
17. As a duty officer, I want every ReliefWeb item surfaced at High by default, so
    that human-curated humanitarian disasters are always prominent.
18. As a duty officer, I want the tier of every surfaced event to be explainable
    from fixed rules, so that I (or a reviewer) can audit why something ranked
    where it did without running a model.

### Change since yesterday (duty officer)

19. As a duty officer, I want the brief to note when a previously reported event
    has materially changed (e.g. "revised from M5.8 to M5.1 since yesterday"), so
    that I am not misled by yesterday's first estimate.
20. As a duty officer, I want the brief to note when a previously reported event
    has been withdrawn/deleted at source, so that I do not keep briefing on
    something that no longer exists.
21. As a duty officer, I want each day's report to reflect the latest feed state at
    run time, so that I always see current data, not stale figures.

### Duplicate awareness (duty officer)

22. As a duty officer, I want events that are likely the same physical disaster
    (same hazard type, close in time and space) flagged with a note, so that I am
    not confused when the same quake appears from two feeds.
23. As a duty officer, I want duplicates flagged but not merged or hidden, so that
    nothing is silently dropped and I can still see each feed's own record.

### Trust & resilience (duty officer / the agent)

24. As a duty officer, I want the run to continue on the remaining feeds when one
    feed is down, so that a single outage does not blank my whole morning brief.
25. As a duty officer, I want the brief to state explicitly which feed was
    unavailable that morning, so that I know the coverage gap rather than
    misreading a quiet feed as a quiet world.
26. As the agent, I want to never crash the whole run because one feed failed, so
    that the duty officer always gets a brief.
27. As the agent, I want to poll the feeds politely and back off on errors, so that
    I stay a good citizen of sources that publish no firm rate limits.
28. As a duty officer, I want the assessment narrative to stay grounded in the feed
    data and never overstate severity, so that I can trust the prose as much as the
    numbers.

### Unattended operation (the agent / operator)

29. As an operator, I want the agent to run unattended once daily at 08:30 SGT via
    GitHub Actions cron, so that the brief is ready every morning without anyone
    triggering it.
30. As an operator, I want the run to commit its dated JSON snapshot and the
    regenerated `dashboard.html` back to the repo, so that state travels with the
    repo and git history is an audit trail of what was reported each day.
31. As an operator, I want to be able to trigger the run manually
    (`workflow_dispatch`), so that I can produce a brief on demand and test the
    pipeline.
32. As an operator, I want the scheduled workflow to run a deterministic
    change-detection step first and only invoke the model when something changed,
    so that the model never decides whether to wake up and idle runs stay cheap.
33. As an operator, I want secrets (LLM API key, future ReliefWeb appname) held in
    repository/organisation secrets, so that no credential lives in the repo.

### Extensibility (developer)

34. As a developer, I want ReliefWeb consumed via RSS in v1 behind an interface
    that the approved-`appname` API can later drop into, so that the build is not
    blocked on the approval email and the upgrade is localised.
35. As a developer, I want the noise-floor and tier thresholds expressed as
    constants, so that they can be tuned later without architectural change.
36. As a developer, I want the deterministic core isolated from HTTP fetching, the
    LLM call, and HTML rendering, so that the behaviour that matters can be tested
    without the network, a model, or a browser.

## Implementation Decisions

### Modules (logical; not file paths)

- **Feed adapters** — one per feed (USGS, GDACS, ReliefWeb). Each is responsible
  for *fetching* (HTTP/RSS) and *normalising* the feed's raw payload into a common
  internal `Event` shape. Fetch and parse are separable so parsing can be tested
  against recorded fixtures without the network. ReliefWeb sits behind an interface
  with an RSS implementation in v1 and a future API implementation (ADR 0008).
- **Core pipeline (`buildSitrep`)** — the single deterministic seam (see Testing
  Decisions). A pure function that takes the raw results of all feed fetches
  (including failures), the previous **snapshot**, and the current time, and
  returns the full render model. It performs: normalise → apply **noise floor** →
  assign **priority tier** → **duplicate flag** → **change detection** vs. the
  prior snapshot → assemble degradation notices. It calls **no network** and
  contains **no LLM call**; the assessment writer and the clock are injected.
- **Assessment writer** — the LLM step. Given a surfaced event (and minimal
  grounding context), returns the narrative string. Injected into / invoked around
  the core so the core stays deterministic (ADR 0003). Prompted to stay grounded in
  feed data and never overstate severity. Length varies by tier (full for
  Critical/High, terser for Moderate).
- **Renderer** — takes the render model and produces the static `dashboard.html`
  (priority view + spatial view + degradation notices), with all interactivity
  client-side and a keyless map library (ADR 0005).
- **Snapshot store** — reads the previous dated JSON snapshot and writes the new
  one; committed to the repo (ADR 0006). No database.
- **Scheduled workflow** — GitHub Actions cron (ADR 0002): deterministic
  change-check first, model/report only on change, then commit snapshot + rendered
  page.

### Core function contract (the seam)

```
buildSitrep(feedResults, priorSnapshot, now) -> SitrepModel

feedResults:  per-feed { status: "ok" | "unavailable", rawPayload?, error? }
priorSnapshot: previous run's SitrepModel-derived snapshot (or null on first run)
now:          injected timestamp (no ambient clock)

SitrepModel:
  generatedAt
  surfaced: [ SurfacedEvent... ]      // sorted most-severe-first
  degradation: [ { feed, reason } ]   // which feeds were unavailable
```

```
SurfacedEvent:
  feed:        "USGS" | "GDACS" | "ReliefWeb"
  feedEventId: string                 // feed's own stable id (for cross-run identity)
  tier:        "CRITICAL" | "HIGH" | "MODERATE"
  hazardType:  e.g. "EQ" | "TC" | "FL" | ...
  location:    { name, coordinates? }  // coordinates absent for ReliefWeb
  metrics:     feed-specific { mag?, sig?, pagerAlert?, alertLevel?, ... }
  time
  duplicateOf?: [ feedEventId... ]     // non-destructive flag; never merged
  changeNote?:  string                 // "revised from M5.8 to M5.1", "withdrawn", ...
  assessment?:  string                 // filled by the assessment writer
```

The assessment field is populated *outside* the pure core (or via an injected
writer) so that `buildSitrep` remains deterministic and testable without a model.

### Filtering & prioritisation (deterministic — ADR 0004)

- **Noise floor:** GDACS Orange+Red (drop Green); USGS M ≥ 4.5; all ReliefWeb items.
- **Tiers:**
  - 🔴 CRITICAL — GDACS Red · USGS M ≥ 6.5 **or** PAGER `alert` ∈ {orange, red}.
  - 🟠 HIGH — GDACS Orange · USGS M 5.5–6.4 · **all** ReliefWeb items.
  - 🟡 MODERATE — USGS M 4.5–5.4.
- USGS is **impact-aware** (PAGER can promote a mid-magnitude quake to Critical).
- ReliefWeb defaults to **High** (human-curated, no magnitude).
- Thresholds are constants, tunable without architectural change.

### Cross-feed identity & revisions

- Feeds are treated **independently**: one feed record = one event (ADR 0007). No
  merging in v1.
- **Duplicate flag**: heuristic on (same hazard type + close in time + close in
  space) → a non-destructive `duplicateOf` note.
- **Per-event identity across runs** uses the feed's own stable id (USGS `id`,
  GDACS `eventid`, ReliefWeb link/GLIDE). USGS carries multiple ids in `ids` but a
  single canonical `id`; store the canonical `id`.
- **Change detection** compares this run's surfaced events to the prior snapshot by
  feed id and emits a `changeNote` on material change (tier/magnitude revised, or
  withdrawn). Cross-feed change tracking is not attempted (ADR 0007/0009).

### Output (ADR 0005)

- Single static `dashboard.html`, rendered client-side, no backend.
- **Priority view**: ranked tier list, most-severe first, colour-coded.
- **Spatial view**: keyless interactive map (MapLibre or Leaflet), severity-coloured
  pins; click a pin → the same **detail card** the list uses.
- ReliefWeb events appear in the list only (no coordinates → never map-pinned).
- Events embedded in the page (e.g. inline GeoJSON) at render time.
- Degradation notices shown on the page when a feed was unavailable.

### Scheduling & persistence (ADR 0002 / 0006)

- GitHub Actions cron timed to 08:30 SGT (UTC+8; cron expressed in UTC), plus
  `workflow_dispatch`. Enable by renaming `sitrep.yml.disabled` once both TODO
  steps exist.
- Workflow order: deterministic change-check (no model) → model/report only if
  changed → commit dated JSON snapshot (`data/YYYY-MM-DD.json`) + regenerated
  `dashboard.html`.
- Secrets in repository/organisation secrets.

### v1 vertical slice & build order (ADR 0010)

Build end-to-end first on one feed, then add breadth:

    USGS → threshold filter → LLM assessment → render dashboard.html → one manual run

Then, in order: GDACS · ReliefWeb (RSS) · interactive map + priority styling · JSON
snapshots · 08:30 SGT scheduled workflow.

## Testing Decisions

**What makes a good test here:** it exercises *external behaviour through a seam*,
not implementation details. For this system that means: given known feed payloads
(and a known prior snapshot and a fixed `now`), assert the *surfaced events, their
tiers, duplicate flags, change notes, and degradation notices* that come out — not
the internal steps that produced them. Tests must not hit the network, must not
call a real model, and must not need a browser.

**Primary seam — the core pipeline (`buildSitrep`).** This is the single, highest
seam and where the bulk of testing effort goes (confirmed with the developer). It
is a pure function: raw feed results + prior snapshot + injected `now` in, render
model out. The LLM assessment writer and the clock are injected, so every
deterministic behaviour is testable with fixtures. Coverage focuses on the
decisions that carry trust:

- **Noise floor**: GDACS Green dropped; USGS M<4.5 dropped; Orange/Red and M≥4.5
  and all ReliefWeb surfaced.
- **Tier assignment**: each boundary (M4.5/5.5/6.5), GDACS Orange→High / Red→Critical,
  PAGER orange/red promotes a mid-mag quake to Critical, ReliefWeb→High.
- **Duplicate flagging**: same hazard + close time/space → flagged (`duplicateOf`),
  not merged; distinct events not flagged.
- **Change detection**: magnitude/tier revision emits a change note; withdrawn
  event noted; unchanged event emits none; first run (no prior snapshot) is clean.
- **Graceful degradation**: an `unavailable` feed result yields a degradation
  notice and the other feeds still surface; no throw.
- **Ordering**: output sorted most-severe-first.

**Secondary (thin adapters, tested separately, lower priority):**

- **Feed parsers**: raw USGS/GDACS/ReliefWeb payload fixtures → normalised `Event`
  shape (canonical id selection, coordinate presence/absence, RSS field
  extraction). Fixture-driven; no network.
- **Renderer**: given a render model, `dashboard.html` contains the expected
  structure (tiers present and ordered, ReliefWeb absent from map data, degradation
  notices present). Structural assertions, not pixel/visual.
- **Assessment writer**: contract-level only — shape/length-by-tier and that it is
  invoked per surfaced event. Content is non-deterministic and is *not*
  asserted for exact prose.

**Prior art:** none in-repo yet (greenfield). Establish the fixture-driven core-seam
pattern as the reference for later tests; record the chosen test command in
`CLAUDE.md` (currently blank).

## Out of Scope

Per ADR 0010, explicitly **not** in v1:

- Report / PDF export, and any true GeoPDF / georeferenced GIS output.
- Cross-feed event **merging** (duplicates are flagged only, never merged).
- Intra-day / breaking updates — once daily only. (v2: a more frequent cron that
  publishes when a Critical-tier event appears. Accepted v1 trade-off: up to ~23h
  latency on an event occurring just after a run.)
- ReliefWeb **API / `appname`** — RSS only in v1.
- ReliefWeb **map pins** — list-only (no coordinates).
- Historical trend analytics.
- Auth / login.
- Notifications beyond the page itself (no email/SMS/push).
- Any realtime push, WebSockets/SSE, or always-on server (ADR 0001 supersedes the
  original `REQS.md` framing).
- The supervisor report hand-off (a duty-officer workflow that lives outside the
  system in v1).

## Further Notes

- **Cardinal trust rule (ADR 0004):** never miss a major event — false negatives
  are the worst failure. "Never miss" reads as *never silently dropped*; timeliness
  is secondary (hence the accepted once-daily latency). Secondary rule: never
  overstate severity.
- **LLM budget:** assume a current Claude model; the assessment pass runs over
  already-filtered events only, keeping token use modest. The model never decides
  inclusion or tier and never decides whether the scheduled run wakes up.
- **First-run behaviour:** with no prior snapshot, change detection produces no
  change notes and duplicate memory is limited to within the current run.
- **GitHub Actions caveat:** scheduled workflows are disabled on repos with no
  recent activity — relevant only for long-idle periods.
- **Workshop artefact mapping (Q19):** planning docs use skill-native filenames
  (`docs/PRD.md`, `FRAME.md`, `SHAPING.md`, `BREADBOARD.md`); these map/export to
  the workshop artefacts (`prd.html`, `system-view.html`, `goal.md`) at the end.
