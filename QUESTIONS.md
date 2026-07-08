# QUESTIONS.md

Scratch file for the grilling process. Questions logged upfront and as we go.
Status legend: ❓ open · ✅ answered · 💤 deferred/out-of-scope

---

## Already answered by the repo (README, feeds/, CLAUDE.md)

- ✅ Domain is **HADR** — humanitarian assistance & disaster response monitoring.
- ✅ Feeds are fixed: **GDACS** (multi-hazard GeoJSON), **USGS** (earthquakes GeoJSON, regen every minute), **ReliefWeb** (UN OCHA curated disasters; API needs a pre-approved `appname`, RSS fallback needs none).
- ✅ Feed geometry is mostly **points** (GeoJSON features / RSS items).
- ✅ The agent's job (per README): *filter noise, assess what remains — what happened, where, how bad, who is affected.* Implies LLM reasoning, not just polling.
- ✅ Expected artefacts (per README): `prd.html`, `system-view.html`, `implementation-notes.md`, `dashboard.html`, `goal.md`, ≥1 skill.
- ✅ It's a **3-day workshop build** (Plan → Autonomy → Trust), runs unattended on a schedule.

---

## 🔴 THE BIG ONE — RESOLVED (product identity)

Your `REQS.md` and the repo `README.md` described two different products. **Decision (Q1): follow the README** → option **(B)**, a scheduled, unattended agent that publishes a **daily 08:30 SGT situation report** to `dashboard.html`.

- ✅ Q1. **Target = scheduled morning-sitrep agent (README model).** REQS.md's interactive-map + realtime-panel framing is superseded.
- ✅ Q2. **No realtime push.** Periodic regeneration on a schedule is the model; no WebSockets/SSE/live server required. (Follows directly from Q1.)

## Users & purpose

- ❓ Q3. Who reads the output — you (portfolio/demo), a response coordinator, an analyst? What do they *do* after reading it?
- ❓ Q4. What's the single most important thing the report/dashboard must get right to be trusted? (accuracy of severity? no missed major events? no false alarms?)

## What counts as an "alert" / what's worth reporting

- ✅ Q5. **Conservative noise floor:** GDACS **Orange + Red**; USGS **M ≥ 4.5**; **all** ReliefWeb curated items. (Tunable later.)
- ✅ Q6/Q10. **Division of labour:** filtering is **rule-based** (Q5 thresholds + USGS PAGER impact); the **LLM writes the assessment narrative** (what happened / where / how bad / who's affected), full prose for Critical/High, terser for Moderate.
- ✅ Q7. **Unified priority is now a required feature.** Reporting must rank events by severity so more severe cases are **more visible** in the app. Requires a common priority scale across the 3 heterogeneous feeds. → see Q7a/Q7b.
- ✅ Q7a. **3-tier priority scale** (Critical / High / Moderate):
  - 🔴 CRITICAL: GDACS Red · USGS M≥6.5 **or** PAGER `alert`=orange/red (impact-aware).
  - 🟠 HIGH: GDACS Orange · USGS M5.5–6.4 · **all** ReliefWeb items (human-curated, no magnitude).
  - 🟡 MODERATE: USGS M4.5–5.4.
  - Confirmed judgement calls: USGS is **impact-aware** (PAGER can promote a mid-mag quake); ReliefWeb defaults to **High**.
- ✅ Q7b. **Exact layout deferred** to design/breadboarding. Carry-forward principle: *severity drives prominence* (most-severe tier first, colour-coded, Critical gets full agent narrative, lower tiers terser/collapsible).

## Cross-feed identity (the hard problem the feeds flag)

- ✅ Q8. **v1: treat feeds independently but flag likely duplicates** (same hazard type + close in time + close in space) with a note — do NOT merge. Full correlation into single events = later spike.
- ✅ Q9. **Each daily report reflects the latest state at run time**; where an event materially changed since yesterday's report (magnitude/severity revised, or withdrawn), the brief **notes the change**. (Enabled by the JSON snapshots, Q13.)

## The agent

- ✅ Q10. See Q6/Q10 above — LLM writes narratives, rules filter. Model/budget: TBD (assume a current Claude model; keep token use modest).
- ✅ Q11. **Once daily, 08:30 SGT** for v1. Accepted trade-off: a major event just after a run isn't shown until the next 08:30 (~23h blind spot); "never miss" (Q4) reads as *never silently dropped*, timeliness secondary. **v2 goal: a more frequent cron** (e.g. intra-day publish when a Critical-tier event appears).
- ✅ Q12. **GitHub Actions cron** (repo already has `.github/`; free, unattended, secrets in repo settings). No managed server.

## Data handling & resilience

- ✅ Q13. **Commit dated JSON snapshots + reports into the repo** (e.g. `data/YYYY-MM-DD.json`). No database. Enables "what changed since yesterday," dedup memory, and git-history audit trail.
- ✅ Q14. **Graceful degradation:** if a feed is down/rate-limited, report on the others and the brief **explicitly states** the feed was unavailable. Never fail silently, never crash the whole run.
- ✅ Q15. **Start on ReliefWeb RSS** (no approval); structure code so the approved-`appname` API drops in later. Don't block the build on the approval email.

## Hosting, scope, effort

- ✅ Q16. **Static `dashboard.html`** (committed / GitHub Pages), rendered client-side. **Includes an interactive map** (keyless MapLibre/Leaflet): severity-coloured pins, **click a pin → detail card**, same card the ranked list uses. Map = spatial view, tier list = priority view.
- ✅ Q16a. **ReliefWeb = list-only** (option a). No coordinates → never faked on the map; appears in the ranked tier list only.
- ✅ Q17. **v1 vertical slice:** USGS → threshold filter → LLM assessment → render `dashboard.html` → one manual run. Then add GDACS, ReliefWeb, scheduling, priority styling, map.
- ✅ Q18. **Out of scope for v1:** report/PDF export, cross-feed event *merging*, intra-day/breaking updates, ReliefWeb API/appname (RSS only), historical trend analytics, auth/login, notifications beyond the page, true GeoPDF/GIS output, ReliefWeb map pins.

## Process/meta

- ✅ Q19. Use skill-native filenames (`docs/PRD.md`, `FRAME.md`, `SHAPING.md`, `BREADBOARD.md`) during planning; **map/export to workshop artefacts** (`prd.html`, `system-view.html`, `goal.md`) at the end.

## Users & purpose

- ✅ Q3. **Persona = duty officer.** Monitors daily, and **generates a report (e.g. a GeoPDF) to send up to supervisors** for their guidance. → introduces a new requirement: an **exportable/shareable report artefact**, not just an on-screen dashboard. See Q20.
- ✅ Q4. **Worst failure = missing a major event (false negative).** Recall at the high-severity end is paramount; the conservative thresholds already capture all Red/major events, consistent with this. Secondary: never overstate severity.

## New requirement surfaced by the persona

- ✅ Q20. (a) **v1 stops at the on-screen `dashboard.html`** — no export in v1. (b) When export lands later, it's a **regular printable PDF** (brief + static map image + ranked list), **not** a true georeferenced GeoPDF. GDAL/GIS tooling avoided.
