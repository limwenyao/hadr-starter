# Implementation notes

Kept by the agent, reviewed by you. One entry per working block.

## Decisions

- **2026-07-08 — v1 slice complete: first manual run.** `npm run sitrep`
  fetched live USGS data, filtered/tiered deterministically, wrote assessments
  via `claude -p`, and rendered `dashboard.html` (priority view only; map,
  other feeds, snapshots, and scheduling are later slices per ADR 0010).

- **2026-07-08 — deferred-debt hardening block.** Cleared the pre-GDACS debt
  ledger. Real fixes: (a) out-of-range/NaN event times could throw `RangeError`
  in the renderer and the assessment prompt — added `src/time.ts`
  (`isValidEventTime` / safe `formatUtc`), a finite+range bound-check in the USGS
  parser (malformed time → feature skipped), routed all time formatting through
  `formatUtc`, and wrapped `run.ts` in a top-level try/catch (exit 1, no unhandled
  crash); (b) `fillAssessments` now returns a fresh object in the empty-surfaced
  case; (c) renderer tier-colour CSS now emits in severity order, not surfaced
  order. Plus characterization tests for parser defensive branches, mixed ok+down
  feeds, null-mag CRITICAL sort tie-break, the `parseAssessmentResponse`
  trailing-`]` fails-safe limitation, and hostile-input escaping
  (locationName / degradation reason / undefined assessment). 43 → 62 tests.

## Open questions

- **Prompt injection via feed text — RESOLVED (2026-07-09, scheduled-workflow slice).**
  Was: feed-supplied text interpolated into the `claude -p` prompt could steer the
  narrative. Mitigated at "Standard" scope in `buildAssessmentPrompt`: untrusted
  free-text (`title`, `locationName`, `duplicateOf.title`, `hazardType`) is passed
  through `neutralizeText` (strip control chars, cap `MAX_FIELD_CHARS`), and the
  prompt frames event data as untrusted / to be ignored if it contains instructions.
  Rules still decide inclusion/tier (ADR 0003/0004). Residuals accepted below.

- **2026-07-10 — Deferred hardening from the Slice 1 review (opencode/GLM-5.2).**
  An adversarial review of `platform-migration-slice1` found no Critical/High-severity
  bugs beyond the three already fixed (snapshot-commit-on-DB-failure `if: always()`;
  `db_write_ok=false` failure audit; 503 no longer leaks DB error text). The remaining
  Low-severity items are accepted for now and tracked here:
  - **#4 `app/` is not typechecked by `npm run typecheck`.** `tsconfig.include` is
    `src`/`test`; CI runs `tsc` but not `next build`, so Next route-handler type errors
    surface only at deploy time. Fix later: add `"app"` to include, or run `next build`
    in CI.
  - **#5 `/api/events` has no error handling.** A DB outage throws an unstructured 500,
    inconsistent with the root route's 503. Fix later: try/catch → `Response.json({...},
    { status: 503 })`.
  - **#6 `/api/events` returns `sourceUrl` unsanitized.** The HTML path sanitizes URLs;
    the JSON API does not. Latent only — nothing but our sanitized dashboard consumes the
    API in Slice 1. Sanitize at the read seam when a second consumer appears (Slice 4).
  - **#7 `String(dbErr)` in `run.ts` may log connection details to CI logs.** Low
    exposure (CI logs are private). Fix later: log `err.message` only.
  - **#8 `persistRun` is not transactional.** The event insert and the `ingest_runs`
    insert are separate statements; a mid-failure can leave them disagreeing. Wrap in
    `db.transaction(...)` when it matters.

## Deviations

<!-- Anything built that departs from the PRD or CLAUDE.md is recorded here,
     with the reason. An undocumented deviation is a bug. -->

- **2026-07-09 — Vitest file parallelism disabled (`vitest.config.ts`, ADR 0011).**
  The two DB integration test files (`db-integration`, `db-persist`) share one Postgres
  and `TRUNCATE` it between cases; Vitest's default parallel file execution let them wipe
  each other's rows mid-test, an intermittent failure caught locally before CI. Set
  `fileParallelism: false` so files run serially. The whole suite is ~2s, so the cost is
  negligible; a per-worker database would be the heavier alternative if parallelism is
  ever needed back. Not in the Slice 1 plan, which omitted cross-file DB test isolation.

- **2026-07-09 — Platform migration (ADR 0011), Slice 1.** Introduced a hosted Postgres
  (Neon) + Drizzle and a Next.js app on Vercel, superseding the static/no-DB v1 design
  (ADRs 0005/0006) and adding a build step (CLAUDE.md tooling note updated). Events are
  stored bitemporally (one row per upstream version). JSON snapshots are dual-written as
  a transitional audit net. Only USGS captures a real `source_updated_at` this slice;
  GDACS/ReliefWeb fall back to `inferred` until Slice 2.

- **2026-07-09 — Schema additions beyond the Slice 1 plan: `depth_km` column +
  CHECK constraints on `feed`/`tier`/`update_provenance` (ADR 0011 / Slice 1).**
  The Slice 1 plan's `event_versions` schema stored only `lon`/`lat` and left
  `feed`/`tier`/`update_provenance` as unconstrained `text`. Two Important findings
  from the final code review were adopted before the (never-yet-applied) Drizzle
  migration was regenerated, so no alter-migration debt was incurred: (a)
  `coordinates.depthKm` was silently dropped on every Postgres round-trip —
  an unrecoverable data gap for earthquake depth once events age out of the
  live feed; added a nullable `depth_km` column plus mapping in both
  directions. (b) an unknown `tier` value written to the DB would be silently
  excluded from every tier group on read (the `as Tier` cast in
  `rowToSurfacedEvent` trusts the column), violating the cardinal "never miss
  a major event" rule; added Postgres CHECK constraints on `feed`, `tier`, and
  `update_provenance` so bad values are rejected at write time instead of
  degrading the read path. CHECK (not `pgEnum`) was chosen because feed
  sources are expected to grow over time and CHECK constraints are easier to
  evolve without an enum migration.

- **2026-07-08 — PAGER-critical events bypass the magnitude noise floor.**
  ADR 0004 literally reads "noise floor: USGS M ≥ 4.5" and separately "CRITICAL:
  PAGER orange/red". A PAGER-red M4.2 quake would satisfy the tier rule but fail
  the floor. Resolved in favour of the cardinal rule (never miss a major event):
  `passesNoiseFloor` surfaces any USGS event with PAGER orange/red regardless of
  magnitude. Green/yellow PAGER does not bypass the floor.

- **2026-07-08 — GDACS magnitude is not extracted.** GDACS carries magnitude only
  inside the `htmldescription` prose string, not a structured field. Parsing it is
  fragile and unnecessary: GDACS tiering is driven entirely by alert level (ADR
  0004), so `metrics.mag` stays undefined for GDACS. Consequence: within a tier the
  magnitude tie-break sorts GDACS events (mag → 0) after magnitude-bearing USGS
  events. Acceptable for v1; revisit if within-tier ordering matters.

- **2026-07-08 — Duplicate flagging is cross-feed only.** ADR 0007 says flag likely
  duplicates (same hazard + close time + close space). We additionally require the
  pair to come from *different* feeds, so two genuinely distinct nearby quakes in a
  single feed are never mislabelled as duplicates. Matches the ADR's rationale (the
  same physical event arriving via USGS and GDACS/NEIC). Window constants
  `DUP_TIME_WINDOW_MS` (±90 min) and `DUP_DISTANCE_KM` (100) live in `thresholds.ts`.

- **2026-07-08 — Duplicate primary selection is severity-order-first.** Within a
  duplicate cluster the primary (unflagged) event is the first in the
  already-severity-sorted list; later members carry `duplicateOf`. Both remain in
  `surfaced` — flagged, never merged or dropped (CLAUDE.md #5).

- **2026-07-08 → RESOLVED 2026-07-09 — Prompt-injection hardening.** Feed text
  flowing into the `claude -p` prompt was left unhardened through the multi-feed
  slices, then closed in the scheduled-workflow slice: `neutralizeText` on untrusted
  free-text + untrusted-data prompt framing (see Open questions above). Two accepted
  residuals recorded below.

- **2026-07-09 — Feed fetches do not retry/back off (ADR 0008 partial).** CLAUDE.md
  #4 and ADR 0008 say "poll politely; back off on errors", but `fetchUsgs/fetchGdacs`
  and the ReliefWeb fetch each make a single request (30s timeout) and, on failure,
  return an `unavailable` FeedResult — the run degrades gracefully rather than
  retrying. Accepted for the daily cadence (a transient blip self-heals next run);
  bounded retry-with-backoff is a tracked enhancement, deferred rather than added as
  untested network code under the review time-box.

- **2026-07-09 — `fillAssessments` keys assessments by `feedEventId` alone.** The
  core identity is `(feed, feedEventId)` (see `changes.ts`/`gate.ts`), but the LLM
  assessment round-trip keys by bare `feedEventId` (the prompt's `id` field the model
  echoes back). A cross-feed `feedEventId` collision would swap two narratives.
  Accepted residual: the feeds' id formats are disjoint (USGS `us…`, GDACS numeric,
  ReliefWeb URL), so a collision is implausible; fixing it would change the prompt's
  id scheme and the parse contract. Tracked; not fixed in the review pass.

- **2026-07-08 — fast-xml-parser is the repo's first runtime dependency.** CLAUDE.md
  asks to keep dependencies few; ReliefWeb is RSS/XML (CDATA, entity-encoded bodies),
  and a hand-rolled parser would be fragile. One small, zero-dependency, well-
  maintained parser was judged the correct trade for robustness. Kept behind the
  `parseReliefWeb` pure function so it stays fixture-testable.

- **2026-07-08 — ReliefWeb consumed via RSS behind a swappable interface.** ADR 0008:
  the approved-`appname` API may not arrive in the build window. `ReliefWebSource`
  bundles `fetch`+`parse`; `reliefWebSource` is the single active binding (RSS now).
  The API implementation drops in by flipping that one line.

- **2026-07-08 — Map dashboard pulls pinned CDN assets.** The dashboard is a single
  static HTML file, but MapLibre GL JS/CSS (pinned 5.24.0, unpkg) and the OpenFreeMap
  `fiord` style/tiles load from CDNs. A fully-offline page was never possible (map
  tiles need network), and inlining ~800KB of library into every daily committed
  dashboard.html would bloat git history. Keyless throughout — no API keys (ADR 0005).

- **2026-07-08 — Dashboard client script is not unit-tested.** Tests run no browser
  (CLAUDE.md), so the inlined client JS (`src/render/client.ts`) is exercised only by
  the live run. Mitigation: all render logic (tier order, badges, sanitized URLs,
  duplicate notes, formatted times) is precomputed in the unit-tested `buildViewModel`;
  the client only builds DOM from the embedded JSON via textContent (never innerHTML
  with feed text — XSS discipline moved from server-side entity-escaping to
  script-block-safe JSON + textContent).

- **2026-07-08 — No-WebGL machines get a bannered fallback, not a raster map.**
  MapLibre GL requires WebGL; on machines without it (e.g. VMs without GPU
  acceleration — including the primary dev machine) the map cannot render. The
  user-directed behaviour: keep the MapLibre stack, announce the failure with a
  **dismissible bottom banner** (reason included) and auto-open the events panel —
  the brief stays fully usable, the map area stays empty. A Leaflet raster
  fallback was considered and declined (second map library, two code paths).

- **2026-07-08 — Light list-only dashboard replaced.** The v1-slice light-themed
  list page is superseded by the map-first dark-blue console (ADR 0005's spatial +
  priority views in one page: full-screen map, icon rail, slide-out tier list).

- **2026-07-08 — Change-detection interpretations of ADR 0009.** (a) Magnitude
  revisions below `MAG_REVISION_MIN` (0.1) are jitter, not material — unnoted.
  (b) "Withdrawn" is flagged only while the event's time is inside the feed's
  rolling window (`FEED_WINDOW_MS`, 24 h): beyond it, disappearing is normal
  aging-out and flagging would overstate (cardinal rule). Wording stays hedged
  ("possibly withdrawn"). (c) Snapshots store the **assessed** model, so each
  `data/YYYY-MM-DD.json` records what the brief actually said (audit trail).
  (d) Intraday re-runs compare against the latest snapshot **strictly before
  today** (yesterday), keeping "since yesterday" notes stable; today's file is
  overwritten (latest state wins). Snapshot date is the UTC date of the run.

- **2026-07-08 — ReliefWeb does not participate in duplicate flagging.** RSS is
  country-level with no coordinates (ADR 0008), so the haversine heuristic never
  matches it (ADR 0007). GLIDE-based correlation is deferred (USGS/GDACS expose no
  GLIDE). `feedEventId` is the `<link>` (stable per-disaster URL); `hazardType` is
  the GLIDE prefix when present, else `"unknown"`.

- **2026-07-09 — Estimate ring uses a calibrated IPE, not the exact AWW-2012 table.**
  The impact-zones spec named Allen-Wald-Worden (2012) as the depth-aware IPE for the
  estimated felt-radius ring. The paper's coefficient table could not be verified in
  this build, so `estimateFeltRadiusKm` uses the standard active-crustal form
  `MMI = IPE_C0 + IPE_C1*M + IPE_C2*log10(R_hyp)` with coefficients CALIBRATED to
  physically-sane felt radii (shallow M5 ~70 km, M6.5 ~300 km), constants in
  `thresholds.ts`. The ring is always rendered as an ESTIMATE (dashed, captioned "not
  an evacuation boundary"), so fidelity is bounded and honest. Swapping in published
  coefficients is a one-line change to `IPE_C0/C1/C2`. Tracked.

- **2026-07-09 — GDACS footprint radiusKm is a rough bbox radius.** `summariseGdacsGeometry`
  reports half the bbox diagonal, not a hazard-specific affected radius. Panel text only;
  the drawn polygon is the authoritative extent.

- **Scheduled quiet-gate is single-process, not two workflow steps.** The
  `sitrep.yml.disabled` comment sketched a separate `scripts/` change-check feeding
  a guarded report step. Implemented instead as a deterministic branch inside
  `run.ts` (`shouldAssess` → `fillAssessments` or `carryForwardAssessments`), because
  the change verdict only exists after `buildSitrep`, and a separate check would
  fetch the live feeds twice and could disagree with the report. The protected
  invariant (deterministic gate, model only on change, model never decides to wake)
  is preserved. No `/sitrep` skill is introduced; the workflow runs `npm run sitrep`.
  (Spec: docs/superpowers/specs/2026-07-09-scheduled-workflow-slice-design.md.)
