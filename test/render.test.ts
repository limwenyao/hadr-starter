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

  it("escapes hostile locationName (feed place text is untrusted)", () => {
    const html = renderDashboard(
      model({
        surfaced: [surfaced({ locationName: '<img src=x onerror="alert(1)">' })],
      }),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("escapes hostile degradation reason (error text is untrusted)", () => {
    const html = renderDashboard(
      model({
        degradation: [{ feed: "USGS", reason: "<b>503</b> & timeout" }],
      }),
    );
    expect(html).not.toContain("<b>503</b>");
    expect(html).toContain("&lt;b&gt;503&lt;/b&gt; &amp; timeout");
  });

  it("renders an empty assessment paragraph when assessment is undefined", () => {
    const html = renderDashboard(
      model({ surfaced: [surfaced({ assessment: undefined })] }),
    );
    expect(html).not.toContain("undefined");
    expect(html).toContain('<p class="assessment"></p>');
  });

  it("blocks non-http(s) sourceUrl schemes but links http(s) ones", () => {
    const hostile = renderDashboard(
      model({
        surfaced: [surfaced({ sourceUrl: "javascript:alert(1)" })],
      }),
    );
    expect(hostile).not.toContain("javascript:");

    const safe = renderDashboard(
      model({
        surfaced: [
          surfaced({ sourceUrl: "https://earthquake.usgs.gov/ev/id-x" }),
        ],
      }),
    );
    expect(safe).toContain('href="https://earthquake.usgs.gov/ev/id-x"');
  });

  it("omits empty tier sections", () => {
    const html = renderDashboard(
      model({ surfaced: [surfaced({ tier: "CRITICAL" })] }),
    );
    expect(html).not.toContain("MODERATE");
  });

  it("does not throw on an out-of-range event time and shows the fallback marker", () => {
    let html = "";
    expect(() => {
      html = renderDashboard(model({ surfaced: [surfaced({ time: 8.7e15 })] }));
    }).not.toThrow();
    // Assert the degraded marker, not just non-throw: a regression that emitted
    // "undefined"/"NaN" instead of throwing would otherwise slip through.
    expect(html).toContain("time unavailable");
  });

  it("orders the tier-colour CSS most-severe-first regardless of surfaced order", () => {
    const html = renderDashboard(
      model({
        surfaced: [
          surfaced({ feedEventId: "m", tier: "MODERATE" }),
          surfaced({ feedEventId: "c", tier: "CRITICAL" }),
        ],
      }),
    );
    // The generated `.tier-CRITICAL` rule must appear before `.tier-MODERATE`.
    expect(html.indexOf(".tier-CRITICAL .tier")).toBeLessThan(
      html.indexOf(".tier-MODERATE .tier"),
    );
  });

  it("renders the GDACS alert level and hazard type as badges", () => {
    const html = renderDashboard(
      model({
        surfaced: [
          surfaced({
            feed: "GDACS",
            hazardType: "TC",
            metrics: { alertLevel: "orange" },
          }),
        ],
      }),
    );
    expect(html).toContain("GDACS");
    expect(html).toContain("alert orange");
    expect(html).toContain(">TC<"); // hazard badge for non-EQ
  });

  it("renders the duplicate-flag note when an event is flagged (escaped)", () => {
    const html = renderDashboard(
      model({
        surfaced: [
          surfaced({
            feed: "GDACS",
            duplicateOf: {
              feed: "USGS",
              feedEventId: "us-1",
              title: "<b>USGS</b> quake",
            },
          }),
        ],
      }),
    );
    expect(html).toContain("Likely the same event as USGS");
    expect(html).not.toContain("<b>USGS</b>");
    expect(html).toContain("&lt;b&gt;USGS&lt;/b&gt; quake");
  });

  it("renders a ReliefWeb card (HIGH, source link, no metric badges)", () => {
    const html = renderDashboard(
      model({
        surfaced: [
          surfaced({
            feed: "ReliefWeb",
            hazardType: "EQ",
            title: "Venezuela: Earthquakes - Jun 2026",
            locationName: "Venezuela",
            metrics: {},
            coordinates: undefined,
            sourceUrl: "https://reliefweb.int/disaster/eq-ven",
            assessment: "Curated humanitarian disaster entry.",
          }),
        ],
      }),
    );
    expect(html).toContain("ReliefWeb");
    expect(html).toContain("HIGH"); // tier badge renders
    expect(html).toContain("Venezuela: Earthquakes - Jun 2026");
    expect(html).toContain('href="https://reliefweb.int/disaster/eq-ven"');
    expect(html).not.toContain('<span class="metric">'); // no severity metrics
  });
});
