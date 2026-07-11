import type { SitrepModel } from "../types.js";
import { buildViewModel } from "./viewModel.js";
import { CLIENT_SCRIPT } from "./client.js";
import type { FeatureCollection } from "geojson";
import type { FetchStatus } from "../types.js";

/**
 * Map-first dashboard (ADR 0005): full-screen keyless MapLibre map, right icon
 * rail, slide-out tier list, detail cards. Dark-blue tech theme. Pure string
 * function — the page's data is the embedded view-model JSON; the inlined
 * client script only builds DOM from it (all logic is in the tested view-model).
 *
 * The shell itself contains no feed-derived text: everything untrusted travels
 * inside the JSON payload (script-block-safe, `<` escaped) and is rendered
 * client-side via textContent.
 */

export const MAPLIBRE_JS =
  "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js";
export const MAPLIBRE_CSS =
  "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css";
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/fiord";

const THEME_CSS = `
  :root {
    --bg: #0a1628; --surface: #0f2137; --panel: rgba(13, 27, 48, 0.92);
    --border: #1e3a5c; --text: #dbe7f3; --muted: #7d95b5; --accent: #38bdf8;
    --critical: #ef4444; --high: #f59e0b; --moderate: #eab308;
    --updated: #10b981;
    --fresh: #22c55e; --recent: #fde047;
    --rail-w: 56px; --panel-w: 380px;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--bg); color: var(--text); overflow: hidden;
  }
  #map { position: absolute; inset: 0 var(--rail-w) 0 0; background: var(--bg); }

  /* --- map fallback banner (no WebGL / library failed) — dismissible --- */
  #fallback-banner {
    position: absolute; left: 1rem; right: calc(var(--rail-w) + 1rem); bottom: 1rem;
    z-index: 40; display: flex; align-items: center; gap: 0.6rem;
    background: var(--surface); border: 1px solid var(--high); border-radius: 10px;
    padding: 0.6rem 0.9rem; font-size: 0.82rem; color: var(--text);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  }
  #fallback-banner[hidden] { display: none; }
  #fallback-reason { color: var(--muted); font-size: 0.74rem; }
  #banner-close {
    margin-left: auto; background: transparent; border: none; color: var(--muted);
    font-size: 1.1rem; cursor: pointer; line-height: 1; padding: 0 0.2rem;
  }
  #banner-close:hover { color: var(--text); }

  /* --- icon rail --- */
  #rail {
    position: absolute; top: 0; right: 0; bottom: 0; width: var(--rail-w);
    background: var(--surface); border-left: 1px solid var(--border);
    display: flex; flex-direction: column; align-items: center;
    padding: 0.75rem 0; gap: 0.75rem; z-index: 30;
  }
  #rail .mark {
    width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center;
    justify-content: center; font-weight: 800; font-size: 0.7rem; letter-spacing: 0.03em;
    color: #06121f; background: var(--accent); user-select: none;
  }
  #rail button {
    position: relative; width: 38px; height: 38px; border-radius: 9px;
    border: 1px solid var(--border); background: transparent; color: var(--muted);
    font-size: 1.05rem; cursor: pointer; transition: color .15s, border-color .15s;
  }
  #rail button:hover { color: var(--text); border-color: var(--accent); }
  #rail #btn-status { color: var(--high); }
  #count-badge {
    position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px;
    border-radius: 9px; background: var(--accent); color: #06121f;
    font-size: 0.68rem; font-weight: 700; line-height: 18px; padding: 0 4px;
  }

  /* --- slide-out event list panel --- */
  #panel {
    position: absolute; top: 0; right: var(--rail-w); bottom: 0; width: var(--panel-w);
    max-width: calc(100vw - var(--rail-w)); background: var(--panel);
    backdrop-filter: blur(6px); border-left: 1px solid var(--border);
    transform: translateX(110%); transition: transform 0.22s ease; z-index: 20;
    display: flex; flex-direction: column;
  }
  body.panel-open #panel { transform: translateX(0); }
  #panel header { padding: 1rem 1.25rem 0.5rem; border-bottom: 1px solid var(--border); }
  #panel h1 { margin: 0; font-size: 1rem; letter-spacing: 0.04em; }
  #meta { margin: 0.3rem 0 0.75rem; color: var(--muted); font-size: 0.78rem; }
  #notices { padding: 0 1.25rem; }
  #notices .notice {
    background: rgba(245, 158, 11, 0.12); border: 1px solid var(--high);
    border-radius: 8px; padding: 0.5rem 0.75rem; margin: 0.75rem 0 0;
    font-size: 0.8rem; color: var(--text);
  }
  #groups { overflow-y: auto; padding: 0.5rem 1.25rem 1.5rem; flex: 1; }
  .group-title {
    font-size: 0.78rem; letter-spacing: 0.08em; margin: 1.1rem 0 0.4rem;
    padding-bottom: 0.3rem; border-bottom: 1px solid var(--border);
    cursor: pointer; user-select: none;
  }
  .group-title::marker { color: var(--muted); }
  .group-title:hover { border-bottom-color: var(--accent); }
  .quiet { color: var(--muted); font-style: italic; padding: 1rem 0; }
  .row {
    padding: 0.6rem 0.6rem; border-radius: 8px; border: 1px solid transparent;
    cursor: pointer; margin: 0.25rem 0;
  }
  .row:hover { background: var(--surface); border-color: var(--border); }
  .row.no-coords { cursor: default; }
  .row-title { font-size: 0.86rem; font-weight: 600; margin-top: 0.3rem; }
  .row-meta { color: var(--muted); font-size: 0.74rem; margin-top: 0.15rem; }

  /* --- chips, badges, tier colours --- */
  .chips { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .chip {
    font-size: 0.62rem; font-weight: 700; letter-spacing: 0.06em;
    padding: 0.12rem 0.4rem; border-radius: 4px; background: var(--border);
    color: var(--text);
  }
  .chip.tier.t-CRITICAL, .group-title.t-CRITICAL { color: var(--critical); }
  .chip.tier.t-HIGH, .group-title.t-HIGH { color: var(--high); }
  .chip.tier.t-MODERATE, .group-title.t-MODERATE { color: var(--moderate); }
  .chip.tier { background: rgba(255, 255, 255, 0.06); }
  .chip.listonly { color: var(--muted); }
  .chip.new { color: var(--accent); background: rgba(56, 189, 248, 0.12); }
  .chip.updated { color: var(--updated); background: rgba(16, 185, 129, 0.12); }
  .card-updated, .row-updated { font-size: 0.72rem; margin: 0.15rem 0 0; }
  /* Colour-coded update recency (ADR 0011): green <60m, yellow <24h, orange beyond. */
  .recency-fresh { color: var(--fresh); }
  .recency-recent { color: var(--recent); }
  .recency-stale { color: var(--high); }
  /* Subtle marker for inferred (approximate) update times — never overstate freshness. */
  .approx { color: var(--muted); }
  .chg { color: var(--moderate); font-size: 0.74rem; font-style: italic; margin: 0.2rem 0 0; }
  #changes { padding: 0 1.25rem; }
  .changes-title {
    font-size: 0.78rem; letter-spacing: 0.08em; margin: 1rem 0 0.2rem;
    color: var(--muted);
  }
  .chg-notice {
    background: rgba(234, 179, 8, 0.1); border: 1px solid var(--moderate);
    border-radius: 8px; padding: 0.5rem 0.75rem; margin: 0.5rem 0 0;
    font-size: 0.8rem;
  }
  .badge {
    display: inline-block; font-size: 0.7rem; background: var(--border);
    border-radius: 4px; padding: 0.05rem 0.35rem; margin-right: 0.3rem;
  }

  /* --- map markers --- */
  .mk {
    width: 15px; height: 15px; border-radius: 50%; padding: 0; cursor: pointer;
    background: var(--mk, var(--accent)); border: 2px solid rgba(255, 255, 255, 0.85);
    box-shadow: 0 0 10px 3px var(--mk, var(--accent));
  }

  /* --- detail card inside the maplibre popup --- */
  .maplibregl-popup-content {
    background: var(--surface); color: var(--text); border: 1px solid var(--border);
    border-radius: 10px; padding: 0.9rem 1rem; box-shadow: 0 8px 30px rgba(0,0,0,.45);
    font-family: inherit;
  }
  .maplibregl-popup-tip { border-top-color: var(--surface) !important; }
  .maplibregl-popup-close-button { color: var(--muted); font-size: 1.1rem; right: 4px; }
  .card { max-width: 320px; }
  .card-title { margin: 0.45rem 0 0.2rem; font-size: 0.92rem; }
  .card-meta { color: var(--muted); font-size: 0.75rem; margin: 0 0 0.4rem; }
  .card .dup { color: var(--moderate); font-size: 0.76rem; font-style: italic; margin: 0.4rem 0 0; }
  .card .assessment { font-size: 0.82rem; margin: 0.45rem 0 0; line-height: 1.45; }
  .card .src { margin: 0.45rem 0 0; }
  .card a { color: var(--accent); }
  #impact-controls { padding: 0.5rem 1.25rem 0; }
  #impact-toggle {
    width: 100%; text-align: left; background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 0.45rem 0.7rem;
    font-size: 0.8rem; cursor: pointer;
  }
  #impact-toggle[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
  #impact-legend { display: flex; gap: 0.75rem; margin: 0.4rem 0 0; font-size: 0.7rem; color: var(--muted); }
  #impact-legend .key::before {
    content: ""; display: inline-block; width: 14px; height: 0; vertical-align: middle;
    margin-right: 0.3rem; border-top: 2px solid var(--muted);
  }
  #impact-legend .key.estimate::before { border-top-style: dashed; }
  .impact-caption { margin: 0.35rem 0 0; font-size: 0.68rem; color: var(--muted); font-style: italic; }
  .row .footprint, .card .footprint { color: var(--muted); font-size: 0.74rem; margin: 0.3rem 0 0; }

  /* --- data sources panel (mirrors #panel) --- */
  #sources-panel {
    position: absolute; top: 0; right: var(--rail-w); bottom: 0; width: var(--panel-w);
    max-width: calc(100vw - var(--rail-w)); background: var(--panel);
    backdrop-filter: blur(6px); border-left: 1px solid var(--border);
    transform: translateX(110%); transition: transform 0.22s ease; z-index: 20;
    display: flex; flex-direction: column;
  }
  body.sources-open #sources-panel { transform: translateX(0); }
  #sources-panel header { padding: 1rem 1.25rem 0.6rem; border-bottom: 1px solid var(--border); }
  #sources-panel h1 { margin: 0; font-size: 1rem; letter-spacing: 0.04em; }
  #sources-sub { margin: 0.3rem 0 0; color: var(--muted); font-size: 0.78rem; }
  #sources-list { overflow-y: auto; padding: 0.5rem 1.25rem 1.5rem; flex: 1; }
  #sources-panel .src { padding: 0.7rem 0; border-bottom: 1px solid var(--border); }
  #sources-panel .src:last-child { border-bottom: none; }
  #sources-panel .src .nm { display: flex; align-items: center; font-size: 0.9rem; font-weight: 700; }
  #sources-panel .src .light {
    margin-left: auto; width: 11px; height: 11px; border-radius: 50%;
    background: var(--muted); box-shadow: 0 0 6px 1px var(--muted);
  }
  #sources-panel .src .light.recency-fresh { background: var(--fresh); box-shadow: 0 0 6px 1px var(--fresh); }
  #sources-panel .src .light.recency-recent { background: var(--recent); box-shadow: 0 0 6px 1px var(--recent); }
  #sources-panel .src .light.recency-stale { background: var(--high); box-shadow: 0 0 6px 1px var(--high); }
  #sources-panel .src .ds { color: var(--muted); font-size: 0.78rem; margin: 0.3rem 0 0.4rem; line-height: 1.4; }
  #sources-panel .src .links { font-size: 0.76rem; margin-bottom: 0.4rem; }
  #sources-panel .src .links a { color: var(--accent); text-decoration: none; }
  #sources-panel .src .links a.feed { color: var(--muted); }
  #sources-panel .src .links .sep { color: var(--border); margin: 0 0.45rem; }
  #sources-panel .src .updated { font-size: 0.76rem; }
  #sources-panel .src .failnote { font-size: 0.74rem; color: var(--muted); margin-top: 0.3rem; }
`;

export function renderDashboard(
  model: SitrepModel,
  geometryById: Record<string, FeatureCollection> = {},
  fetchStatus: FetchStatus | null = null,
): string {
  // Escape every "<" in the JSON (to the \\u003c sequence) so feed text can
  // never close the script block (e.g. a hostile "</script>" in a title).
  const payload = JSON.stringify(buildViewModel(model, fetchStatus)).replace(/</g, "\\u003c");
  const geomPayload = JSON.stringify(geometryById).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HADR Monitor — Situation Report</title>
<link rel="stylesheet" href="${MAPLIBRE_CSS}">
<style>${THEME_CSS}</style>
</head>
<body class="panel-open">
<div id="map"></div>
<div id="fallback-banner" hidden role="status">
  <span>⚠ Interactive map unavailable — all surfaced events remain available in the events panel.</span>
  <span id="fallback-reason"></span>
  <button id="banner-close" aria-label="Dismiss map warning" title="Dismiss">✕</button>
</div>
<nav id="rail" aria-label="Dashboard controls">
  <div class="mark" title="HADR Monitor">HM</div>
  <button id="btn-events" title="Toggle event list" aria-label="Toggle event list">▤<span id="count-badge"></span></button>
  <button id="btn-status" hidden title="Feed status notices" aria-label="Feed status notices">⚠</button>
  <button id="btn-sources" title="Data sources" aria-label="Data sources">⛁</button>
</nav>
<aside id="panel" aria-label="Surfaced events">
  <header>
    <h1>HADR MONITOR — Situation Report</h1>
    <p id="meta"></p>
  </header>
  <div id="notices"></div>
  <div id="changes"></div>
  <div id="impact-controls">
    <button id="impact-toggle" type="button" aria-pressed="false">Impact areas: off</button>
    <div id="impact-legend">
      <span class="key modeled">modeled</span>
      <span class="key estimate">estimate</span>
    </div>
    <p class="impact-caption">Modeled or estimated extents — not official evacuation boundaries.</p>
  </div>
  <div id="groups"></div>
</aside>
<aside id="sources-panel" aria-label="Data sources">
  <header>
    <h1>DATA SOURCES</h1>
    <p id="sources-sub"></p>
  </header>
  <div id="sources-list"></div>
</aside>
<noscript>
  <p style="position:absolute;z-index:99;background:#0f2137;color:#dbe7f3;padding:1rem;margin:1rem;border-radius:8px;">
    This brief needs JavaScript for the interactive map and event list.
  </p>
</noscript>
<script id="sitrep-data" type="application/json">${payload}</script>
<script id="sitrep-geometry" type="application/json">${geomPayload}</script>
<script src="${MAPLIBRE_JS}"></script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
