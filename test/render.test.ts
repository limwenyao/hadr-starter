import { describe, it, expect } from "vitest";
import { renderDashboard } from "../src/render/dashboard.js";
import type { SitrepModel, SurfacedEvent } from "../src/types.js";

function surfaced(over: Partial<SurfacedEvent>): SurfacedEvent {
  return {
    feed: "USGS",
    feedEventId: "id-x",
    hazardType: "EQ",
    title: "M 5.8 - test quake",
    locationName: "near Testville",
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

describe("renderDashboard (priority view — ADR 0005, map is a later slice)", () => {
  it("orders tier sections most-severe-first", () => {
    const html = renderDashboard(
      model({
        surfaced: [
          surfaced({ feedEventId: "c", tier: "CRITICAL", title: "crit quake" }),
          surfaced({ feedEventId: "h", tier: "HIGH", title: "high quake" }),
          surfaced({ feedEventId: "m", tier: "MODERATE", title: "mod quake" }),
        ],
      }),
    );
    const critical = html.indexOf("crit quake");
    const high = html.indexOf("high quake");
    const moderate = html.indexOf("mod quake");
    expect(critical).toBeGreaterThan(-1);
    expect(critical).toBeLessThan(high);
    expect(high).toBeLessThan(moderate);
  });

  it("renders the detail card: feed, tier, location, metrics, assessment", () => {
    const html = renderDashboard(
      model({
        surfaced: [surfaced({ metrics: { mag: 5.8, pagerAlert: "yellow" } })],
      }),
    );
    expect(html).toContain("USGS");
    expect(html).toContain("HIGH");
    expect(html).toContain("near Testville");
    expect(html).toContain("M 5.8");
    expect(html).toContain("PAGER yellow");
    expect(html).toContain("A strong quake near Testville.");
  });

  it("shows the generated-at timestamp (UTC)", () => {
    const html = renderDashboard(model({}));
    expect(html).toContain("2026-07-08T00:30:00.000Z");
  });

  it("states explicitly when a feed was unavailable (ADR 0008)", () => {
    const html = renderDashboard(
      model({ degradation: [{ feed: "USGS", reason: "HTTP 503" }] }),
    );
    expect(html).toContain("USGS feed unavailable");
    expect(html).toContain("HTTP 503");
  });

  it("shows a quiet-morning message when nothing surfaced", () => {
    const html = renderDashboard(model({}));
    expect(html).toContain("No surfaced events");
  });

  it("escapes feed-derived text (no HTML injection from feed data)", () => {
    const html = renderDashboard(
      model({
        surfaced: [
          surfaced({
            title: '<script>alert("x")</script>',
            assessment: "safe & sound",
          }),
        ],
      }),
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("safe &amp; sound");
  });

  it("omits empty tier sections", () => {
    const html = renderDashboard(
      model({ surfaced: [surfaced({ tier: "CRITICAL" })] }),
    );
    expect(html).not.toContain("MODERATE");
  });
});
