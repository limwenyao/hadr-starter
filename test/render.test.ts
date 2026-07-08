import { describe, it, expect } from "vitest";
import {
  renderDashboard,
  MAPLIBRE_JS,
  MAPLIBRE_CSS,
  MAP_STYLE_URL,
} from "../src/render/dashboard.js";
import { buildViewModel } from "../src/render/viewModel.js";
import type { SitrepModel, SurfacedEvent } from "../src/types.js";

function surfaced(over: Partial<SurfacedEvent>): SurfacedEvent {
  return {
    feed: "USGS",
    feedEventId: "id-x",
    hazardType: "EQ",
    title: "M 5.8 - test quake",
    locationName: "near Testville",
    coordinates: { lon: 178.4, lat: -19.1, depthKm: 550 },
    time: Date.UTC(2026, 6, 8, 0, 15),
    metrics: { mag: 5.8 },
    tier: "HIGH",
    assessment: "A strong quake near Testville.",
    ...over,
  };
}

function model(over: Partial<SitrepModel>): SitrepModel {
  return {
    generatedAt: Date.UTC(2026, 6, 8, 0, 30),
    surfaced: [],
    degradation: [],
    ...over,
  };
}

/** Pull the embedded payload back out of the page. */
function extractPayload(html: string): unknown {
  const m = /<script id="sitrep-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]);
}

describe("renderDashboard (map-first shell — ADR 0005)", () => {
  it("embeds the view-model JSON, round-tripping exactly", () => {
    const m = model({
      surfaced: [
        surfaced({ feedEventId: "c", tier: "CRITICAL", metrics: { mag: 7.2 } }),
        surfaced({ feedEventId: "h" }),
      ],
      degradation: [{ feed: "ReliefWeb", reason: "HTTP 406" }],
    });
    expect(extractPayload(renderDashboard(m))).toEqual(
      JSON.parse(JSON.stringify(buildViewModel(m))),
    );
  });

  it("keeps hostile feed text from breaking out of the script block", () => {
    const hostile = '</script><script>alert(1)</script>';
    const html = renderDashboard(
      model({ surfaced: [surfaced({ title: hostile, locationName: hostile })] }),
    );
    // Exactly the three legitimate script opens: payload, maplibre CDN, client.
    expect(html.match(/<script/g)).toHaveLength(3);
    // And the hostile string survives the round-trip intact for the client.
    const vm = extractPayload(html) as { tiers: { events: { title: string }[] }[] };
    expect(vm.tiers[0].events[0].title).toBe(hostile);
  });

  it("never emits non-http(s) source URLs anywhere in the page", () => {
    const html = renderDashboard(
      model({ surfaced: [surfaced({ sourceUrl: "javascript:alert(1)" })] }),
    );
    expect(html).not.toContain("javascript:alert(1)");
  });

  it("pins the map library and dark style by exact URL", () => {
    const html = renderDashboard(model({}));
    expect(MAPLIBRE_JS).toMatch(/maplibre-gl@\d+\.\d+\.\d+\/dist\/maplibre-gl\.js$/);
    expect(html).toContain(`src="${MAPLIBRE_JS}"`);
    expect(html).toContain(`href="${MAPLIBRE_CSS}"`);
    expect(MAP_STYLE_URL).toBe("https://tiles.openfreemap.org/styles/fiord");
    expect(html).toContain("styles/fiord"); // client script points at the same style
  });

  it("renders the shell: map, icon rail, events button, panel, fallback, noscript", () => {
    const html = renderDashboard(model({}));
    for (const id of ["map", "map-fallback", "rail", "btn-events", "btn-status", "count-badge", "panel", "meta", "notices", "groups"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("<noscript>");
    expect(html).toContain("Map unavailable");
  });

  it("applies the dark-blue theme tokens", () => {
    const html = renderDashboard(model({}));
    expect(html).toContain("--bg: #0a1628");
    expect(html).toContain("--accent: #38bdf8");
    expect(html).toContain("--critical: #ef4444");
  });

  it("contains no feed-derived text outside the JSON payload", () => {
    const html = renderDashboard(
      model({ surfaced: [surfaced({ title: "UNIQUE-TITLE-MARKER" })] }),
    );
    const occurrences = html.split("UNIQUE-TITLE-MARKER").length - 1;
    expect(occurrences).toBe(1); // once, inside the payload only
  });
});
