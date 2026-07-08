# Interactive map dashboard slice — design

- Date: 2026-07-08
- Status: Approved (brainstorming)
- Slice: interactive keyless map + priority styling (ADR 0005; ADR 0010 order:
  feeds ✓ → **map** → snapshots → schedule)

## Goal

Replace the list-only light page with a **map-first, dark-blue tech console**:
full-screen MapLibre map, severity-coloured markers opening detail cards, a right
icon rail whose events icon expands a tier-grouped event list. Same single static
`dashboard.html`, no backend, no API keys.

## Non-goals

- No printable/PDF view (out of v1 scope, ADR 0005).
- No coordinates for ReliefWeb — list-only rows, never fabricated pins (ADR 0005).
- No offline bundle: tiles need network regardless; JS/CSS come from pinned CDN.

## Stack (user-selected)

- **MapLibre GL JS 5.24.0**, pinned, from unpkg CDN (js + css; URLs verified).
- **OpenFreeMap `fiord`** vector style — `https://tiles.openfreemap.org/styles/fiord`,
  keyless, dark blue-grey; matches the theme without custom tinting (verified live).

## Layout

- **Full-screen map**; no header bar — run metadata lives at the top of the panel.
- **Icon rail** (right, fixed, ~56px): app mark; events icon with surfaced-count
  badge (toggles the list panel); warning icon shown **only** when a feed degraded
  (toggles degradation notices).
- **Event list panel** (slide-out ≈380px, dark translucent): generated-at + feeds
  line; tier groups CRITICAL → HIGH → MODERATE (severity colours); rows show tier
  chip, title, location, UTC time. Row click: with coords → `flyTo` + open that
  event's detail card; without coords (ReliefWeb) → row shows a "list-only" glyph
  and opens no card.
- **Detail card** = MapLibre popup styled as a dark card: feed + tier chips, title,
  location, UTC time, metric badges, duplicate note, assessment, source link. One
  open at a time.
- **Empty state**: zero surfaced events → panel auto-opens with the "quiet morning"
  message; map at world view.
- **No-WebGL / MapLibre-init failure**: styled notice replaces the map and the panel
  auto-opens — the brief remains fully usable (never fail silently).

## Architecture — logic stays server-side and testable

`renderDashboard(model)` remains a **pure string function** (the seam contract and
the no-browser test rule are unchanged):

1. **View-model builder** (`buildViewModel(model)`, exported for tests): precomputes
   everything the client needs so the client script contains **no logic worth
   testing** —
   - tier groups in severity order with counts;
   - per event: feed, tier, title, location, `timeUtc` (via `formatUtc`), metric
     badge strings (`M 7.2`, `PAGER red`, `alert orange`, `sig 900`, hazard code for
     non-EQ), `duplicateNote` string or null, `assessment`, `sourceUrl` **sanitized
     server-side** (http(s) only, else null), `coordinates` or null;
   - degradation notices; generated-at string; total count.
2. **Payload embed**: view-model JSON inside
   `<script id="sitrep-data" type="application/json">`, with every `<` escaped to
   the JSON escape sequence backslash-u003c so feed text can never close the script block.
3. **Client script**: a static template constant (`src/render/client.ts`), inlined
   into the page. Reads the payload, builds rail/panel/markers/cards using
   `createElement` + `textContent` **only** — never `innerHTML` with feed-derived
   strings. Marker = styled DOM element (severity dot + glow). Fits bounds on load.
4. **Theme**: CSS custom properties in one block — bg `#0a1628`, surface `#0f2137`,
   panel `rgba(13,27,48,.92)`, border `#1e3a5c`, text `#dbe7f3`, muted `#7d95b5`,
   accent `#38bdf8`; tier colours `#ef4444` / `#f59e0b` / `#eab308`.

## Testing (vitest, no browser — unchanged rules)

- **JSON round-trip**: extract `#sitrep-data` content from the HTML, `JSON.parse`,
  deep-compare with `buildViewModel(model)` — the strongest no-browser assertion.
- **Script-breakout**: hostile title containing `</script><script>` survives the
  round-trip intact and does not add `<script` occurrences to the page.
- **View-model unit tests**: badge strings, sanitized sourceUrl (javascript: → null),
  tier grouping/order, duplicate note text, ReliefWeb `coordinates: null`.
- **Shell assertions**: pinned CDN URLs, fiord style URL, rail/panel markup ids,
  fallback notice text, theme tokens present.
- Old light-theme render tests are replaced accordingly.

## Trade-offs accepted (→ implementation-notes Deviations)

- **Pinned CDN dependencies** (maplibre-gl 5.24.0 js/css + OpenFreeMap style):
  offline was never possible (tiles); inlining ~800KB into daily commits would
  bloat git history.
- **Client script is not unit-tested** (no browser in tests); mitigated by pushing
  all logic into the tested view-model and keeping the client declarative.
- The previous light list-only page is fully replaced.
