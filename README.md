# HADR Monitor

A monitoring agent for humanitarian assistance and disaster response (HADR).

## The end state

By Wednesday afternoon this repository contains an agent that:

- watches live disaster feeds — GDACS, USGS and ReliefWeb (see `feeds/`)
- filters out the noise and assesses what remains: what happened, where, how bad, who is affected
- publishes a morning situation report to `dashboard.html` at 08:30 Singapore time
- runs on a schedule, unattended, and stays quiet when nothing has changed

How it does any of that is not specified anywhere in this repository. That is the course.

## Running locally

Prerequisites:

- **Node 20 LTS or newer** and npm
- the **`claude` CLI** signed in (the assessment step runs `claude -p` headless; without it the run still completes, with fallback assessment text)

```bash
npm install          # install dependencies (lockfile is committed)
npm test             # vitest — offline: no network, no model, no browser
npm run typecheck    # tsc --noEmit
npm run sitrep       # one full run: fetch feeds → filter/tier → assess → render
```

`npm run sitrep` polls USGS and GDACS (and ReliefWeb RSS) live, assigns priority
tiers by deterministic rules, writes the assessment narratives via headless
Claude, and produces **`dashboard.html`** in the repo root. Open it in a browser:

```bash
start dashboard.html   # Windows (or just double-click the file)
```

Good to know:

- **Feed failures degrade gracefully** (ADR 0008): if a feed is down the run
  continues on the others and the dashboard states which feed was missing.
  ReliefWeb's RSS endpoint currently bot-shields automated requests (HTTP 406) —
  seeing it listed as unavailable is expected until the approved-appname API
  lands.
- **The map needs WebGL.** On machines without GPU acceleration the dashboard
  shows a dismissible warning banner and auto-opens the events panel — the full
  brief remains readable without the map.
- Tests never touch the network or a model; they drive the pure
  `buildSitrep` seam with recorded feed fixtures (see `CLAUDE.md`).

## The three days

1. **Plan** — interrogate the feeds, write the PRD, cut it into vertical slices
2. **Autonomy** — build the first slice, write a skill, wire up the 08:30 routine, launch the overnight loop
3. **Trust** — review code you didn't write, harden the pipeline, demo

## Artefacts expected by the end

`prd.html` · `system-view.html` · `implementation-notes.md` · `dashboard.html` · `goal.md` · at least one skill

## Day 1 setup

1. Sign in to Claude Code with your Team seat
2. Create your own repository from this template, then clone it
3. Run `/install-github-app` so @claude reviews your pull requests from Day 2
4. Install OpenCode and sign in with your Go key

Fill in `CLAUDE.md` before your first prompt.
