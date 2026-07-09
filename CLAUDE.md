# CLAUDE.md

Shared conventions for HADR Monitor. Vocabulary is defined in `CONTEXT.md`;
architectural decisions live in `docs/adr/`; the spec is `docs/PRD.md`. This file
governs *how* we build; those govern *what* and *why*.

## Language & tooling

- **TypeScript on Node** (Node 20 LTS), **ESM** (`"type": "module"`), `strict: true`.
- **npm** for dependency management; commit the lockfile.
- **Run** TypeScript directly with **tsx** (no separate build step for scripts).
- **Test** with **Vitest**.
- **Output**: a single static `dashboard.html`, rendered server-side by our code,
  with a **keyless** client-side map (MapLibre or Leaflet) — no API keys, no backend.
- **Scheduling**: GitHub Actions cron; the report step invokes headless Claude
  (`claude -p`). Prefer the current Claude model; keep token use modest.
- Keep dependencies few. No database (state is dated JSON snapshots — ADR 0006).
- **App build step (ADR 0011):** the deployed app is a **Next.js** project on Vercel and
  therefore has a build step, superseding the "no build step" rule *for the app*. The
  pure core (`src/`) and its scripts still run under **tsx**; tests still use Vitest.

## Test command

```
npm test          # vitest run (CI / one-shot)
npm run test:watch # vitest (local watch)
```

Tests must not hit the network, call a real model, or need a browser. Drive
behaviour through the seam; use recorded feed payloads as fixtures.

## Conventions

1. **One deterministic core seam.** All filtering, tier assignment, duplicate
   flagging, and change detection live in the pure `buildSitrep(feedResults,
   priorSnapshot, now)` function. It calls **no network** and makes **no LLM call**.
   The assessment writer and the clock (`now`) are **injected**. Tests attach here
   (see `docs/PRD.md` → Testing Decisions).
2. **Rules decide; the LLM only describes.** Filtering and priority tiers are
   deterministic and auditable (ADR 0003/0004). The LLM writes the **assessment**
   narrative only — it never decides inclusion or tier, and never decides whether a
   scheduled run wakes up.
3. **Thresholds are named constants.** The noise floor and tier boundaries (ADR
   0004) live as constants in one place, tunable without touching logic.
4. **Never fail silently.** If a feed is unavailable the run continues on the
   others and the brief **states** which feed was missing (ADR 0008). No unhandled
   throw may crash the run. Poll politely; back off on errors.
5. **Never overstate; never silently drop.** The cardinal rule is *never miss a
   major event* (ADR 0004). Duplicates are **flagged, not merged** (ADR 0007).
   Assessments stay grounded in feed data.
6. **Use the domain vocabulary exactly.** "Surfaced event", "priority tier"
   (Critical/High/Moderate), "alert level" (GDACS only), "PAGER alert" (USGS only),
   "assessment" (LLM prose only), "the agent" (whole automation). Do not conflate
   them (`CONTEXT.md` → Terminology discipline).
7. **Adapters are thin and swappable.** Each feed's fetch and parse are separable
   (parse testable from fixtures). ReliefWeb sits behind an interface: RSS in v1,
   the approved-`appname` API drops in later (ADR 0008).
8. **State travels with the repo.** Persist each run as `data/YYYY-MM-DD.json` and
   commit it; git history is the audit trail (ADR 0006).
9. **Build the vertical slice first**, then add breadth in the ADR 0010 order.
   Respect the v1 scope boundary — don't build out-of-scope items "helpfully".
10. **Prefer pure functions and dependency injection** over ambient state, hidden
    I/O, and singletons — it keeps the core at the seam testable.

## Deviations policy

Anything built that departs from `docs/PRD.md`, the ADRs, or this file **must** be
recorded in `implementation-notes.md` under **Deviations**, with the reason. An
undocumented deviation is a bug. If a decision in an ADR turns out to be wrong,
supersede it with a new ADR rather than quietly working around it.
