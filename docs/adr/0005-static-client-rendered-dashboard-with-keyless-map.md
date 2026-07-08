# ADR 0005 — Static client-rendered dashboard with a keyless map

- Status: Accepted
- Date: 2026-07-08

## Context

The output is a scheduled daily brief (ADR 0001), so it does not need a live server.
The duty officer needs both a priority ranking and a spatial view, and (per the
persona) wants to see event locations pinned and open cards with event details.
Two of three feeds (GDACS, USGS) carry point coordinates; ReliefWeb (RSS) does not.

## Decision

Render output as a **single static `dashboard.html`**, committed to the repo /
served via GitHub Pages, with all interactivity **client-side**. It presents two
coordinated views of the same surfaced events:

- **Priority view** — ranked tier list (Critical → High → Moderate), most-severe
  first, colour-coded.
- **Spatial view** — an interactive map using a **keyless** library (MapLibre or
  Leaflet), with severity-coloured **pins**; clicking a pin opens a **detail card**
  (the same card the list uses).

Exact layout/visual design is deferred to the breadboarding step; the carried
principle is **severity drives prominence**.

## Consequences

- No API keys, no map billing, no backend — fits the static/scheduled model.
- Events are embedded in the page (e.g. inline GeoJSON) at render time.
- ReliefWeb events appear in the **list only** (see ADR 0007); the map never shows
  fabricated coordinates.
- A future printable-PDF export (out of scope for v1) can render from this same page.
