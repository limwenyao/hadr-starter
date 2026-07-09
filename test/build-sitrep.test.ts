import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSitrep } from "../src/core/buildSitrep.js";
import type { FeedResult } from "../src/types.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/usgs-all-day.json", import.meta.url), "utf8"),
);

const NOW = new Date("2026-07-08T00:30:00Z");

const usgsOk: FeedResult = { feed: "USGS", status: "ok", rawPayload: fixture };
const usgsDown: FeedResult = {
  feed: "USGS",
  status: "unavailable",
  error: "HTTP 503",
};

describe("buildSitrep (the seam — pure, deterministic)", () => {
  it("surfaces only events at or above the noise floor", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    const ids = model.surfaced.map((e) => e.feedEventId);
    // fixture case map: aaa1 M7.2, aaa2 M5.8, aaa3 M4.6, aaa5 M4.8+PAGER red
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain("ci41287863"); // M3.0 — noise
    expect(ids).not.toContain("us7000aaa6"); // mag null — noise
  });

  it("assigns priority tiers per ADR 0004", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    const tierOf = (id: string) =>
      model.surfaced.find((e) => e.feedEventId === id)?.tier;
    expect(tierOf("us7000aaa1")).toBe("CRITICAL"); // M7.2
    expect(tierOf("us7000aaa5")).toBe("CRITICAL"); // M4.8 + PAGER red
    expect(tierOf("us7000aaa2")).toBe("HIGH"); // M5.8
    expect(tierOf("us7000aaa3")).toBe("MODERATE"); // M4.6
  });

  it("sorts most-severe-first: tier order, then magnitude descending", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    expect(model.surfaced.map((e) => e.feedEventId)).toEqual([
      "us7000aaa1", // CRITICAL M7.2
      "us7000aaa5", // CRITICAL M4.8 (PAGER)
      "us7000aaa2", // HIGH M5.8
      "us7000aaa3", // MODERATE M4.6
    ]);
  });

  it("turns an unavailable feed into a degradation notice, never a throw", () => {
    const model = buildSitrep([usgsDown], null, NOW);
    expect(model.surfaced).toEqual([]);
    expect(model.degradation).toEqual([{ feed: "USGS", reason: "HTTP 503" }]);
  });

  it("reports no degradation when all feeds are ok", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    expect(model.degradation).toEqual([]);
  });

  it("stamps generatedAt from the injected clock", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    expect(model.generatedAt).toBe(NOW.getTime());
  });

  it("accepts a null prior snapshot (first run)", () => {
    expect(() => buildSitrep([usgsOk], null, NOW)).not.toThrow();
  });

  it("does not attach assessments (the LLM writes those outside the core)", () => {
    const model = buildSitrep([usgsOk], null, NOW);
    for (const e of model.surfaced) expect(e.assessment).toBeUndefined();
  });

  it("surfaces the ok feed's events AND reports the unavailable feed (mixed run)", () => {
    // One healthy feed alongside one that is down — the run must not go dark on
    // the good feed, and must state the missing one (ADR 0008). This is the
    // shape every multi-feed run takes once GDACS/ReliefWeb land.
    const gdacsDown: FeedResult = {
      feed: "GDACS",
      status: "unavailable",
      error: "timeout",
    };
    const model = buildSitrep([usgsOk, gdacsDown], null, NOW);
    expect(model.surfaced.length).toBeGreaterThan(0);
    expect(model.surfaced.every((e) => e.feed === "USGS")).toBe(true);
    expect(model.degradation).toEqual([{ feed: "GDACS", reason: "timeout" }]);
  });

  it("breaks CRITICAL ties by magnitude, sorting a null-mag PAGER event last", () => {
    // A PAGER-red event with no magnitude surfaces (never miss a major event)
    // and is CRITICAL; its undefined mag must sort as 0 — after a real M5.0,
    // never ahead of it. Locks the `(mag ?? 0)` tie-break.
    const feat = (id: string, mag: number | null) => ({
      id,
      properties: { time: 1783300000000, mag, alert: "red", place: "somewhere" },
      geometry: { coordinates: [0, 0, 10] },
    });
    const payload = { features: [feat("null-mag", null), feat("mag-5", 5.0)] };
    const model = buildSitrep(
      [{ feed: "USGS", status: "ok", rawPayload: payload }],
      null,
      NOW,
    );
    expect(model.surfaced.map((e) => e.feedEventId)).toEqual(["mag-5", "null-mag"]);
  });

  // --- GDACS feed (ADR 0004 rules, ADR 0007 duplicate flagging) ---

  const gdacsFeat = (
    id: string,
    alertlevel: string,
    over: Record<string, unknown> = {},
  ) => ({
    properties: {
      eventtype: "EQ",
      eventid: id,
      name: `GDACS ${id}`,
      alertlevel,
      country: "Testland",
      fromdate: "2026-07-06T09:15:00",
      url: { report: "https://www.gdacs.org/report.aspx" },
      ...over,
    },
    geometry: { coordinates: [10, 10] },
  });

  const gdacsOk = (...feats: unknown[]): FeedResult => ({
    feed: "GDACS",
    status: "ok",
    rawPayload: { features: feats },
  });

  it("surfaces GDACS Orange/Red and drops Green (ADR 0004 noise floor)", () => {
    const model = buildSitrep(
      [gdacsOk(gdacsFeat("g-green", "Green"), gdacsFeat("g-orange", "Orange"), gdacsFeat("g-red", "Red"))],
      null,
      NOW,
    );
    const ids = model.surfaced.map((e) => e.feedEventId);
    expect(ids).toContain("g-orange");
    expect(ids).toContain("g-red");
    expect(ids).not.toContain("g-green");
  });

  it("tiers GDACS Red as CRITICAL and Orange as HIGH (ADR 0004)", () => {
    const model = buildSitrep(
      [gdacsOk(gdacsFeat("g-red", "Red"), gdacsFeat("g-orange", "Orange"))],
      null,
      NOW,
    );
    const tierOf = (id: string) =>
      model.surfaced.find((e) => e.feedEventId === id)?.tier;
    expect(tierOf("g-red")).toBe("CRITICAL");
    expect(tierOf("g-orange")).toBe("HIGH");
  });

  it("flags a GDACS quake as a duplicate of the co-located USGS quake, keeping both", () => {
    // USGS aaa1 is the Fiji M7.2 (CRITICAL, lon 178.4/lat -19.1, time 1783300000000).
    // A GDACS Red EQ at the same place & time is the same physical event via NEIC.
    const sameTime = new Date(1783300000000).toISOString();
    const gdacs = gdacsOk(
      gdacsFeat("g-fiji", "Red", {
        fromdate: sameTime,
      }),
    );
    // Override the GDACS feature's coordinates to match USGS aaa1.
    (gdacs as { rawPayload: { features: { geometry: { coordinates: number[] } }[] } })
      .rawPayload.features[0].geometry.coordinates = [178.4, -19.1];

    const model = buildSitrep([usgsOk, gdacs], null, NOW);
    const usgs = model.surfaced.find((e) => e.feedEventId === "us7000aaa1");
    const dup = model.surfaced.find((e) => e.feedEventId === "g-fiji");
    expect(usgs).toBeDefined();
    expect(dup).toBeDefined(); // never dropped
    expect(usgs!.duplicateOf).toBeUndefined(); // USGS is primary (sorted first)
    expect(dup!.duplicateOf).toMatchObject({ feed: "USGS", feedEventId: "us7000aaa1" });
  });

  // --- ReliefWeb feed (ADR 0004: all surface, HIGH; ADR 0008: no coordinates) ---

  const reliefWebOk = (xml: string): FeedResult => ({
    feed: "ReliefWeb",
    status: "ok",
    rawPayload: xml,
  });

  const rwItem = (link: string, title: string, pubDate: string) =>
    `<item><title>${title}</title><link>${link}</link><pubDate>${pubDate}</pubDate>
     <description>&lt;div class="tag glide"&gt;Glide: EQ-2026-000093-VEN&lt;/div&gt;</description></item>`;

  it("surfaces every ReliefWeb item as HIGH (ADR 0004)", () => {
    const xml = `<rss><channel>
      ${rwItem("https://reliefweb.int/disaster/a", "Venezuela: Earthquakes", "Wed, 24 Jun 2026 00:00:00 +0000")}
      ${rwItem("https://reliefweb.int/disaster/b", "Chad: Floods", "Fri, 03 Jul 2026 00:00:00 +0000")}
    </channel></rss>`;
    const model = buildSitrep([reliefWebOk(xml)], null, NOW);
    expect(model.surfaced).toHaveLength(2);
    expect(model.surfaced.every((e) => e.feed === "ReliefWeb" && e.tier === "HIGH")).toBe(true);
  });

  it("never flags a ReliefWeb item as a duplicate (no coordinates to match on)", () => {
    // A ReliefWeb Venezuela EQ alongside a USGS quake at the same instant: without
    // coordinates the spatial heuristic can't match, so ReliefWeb is never flagged.
    const sameTime = "Wed, 24 Jun 2026 00:00:00 +0000";
    const rwXml = `<rss><channel>${rwItem(
      "https://reliefweb.int/disaster/eq-ven",
      "Venezuela: Earthquakes",
      sameTime,
    )}</channel></rss>`;
    const usgsFeat = {
      id: "us-ven",
      properties: { time: Date.parse(sameTime), mag: 7.2, place: "Venezuela" },
      geometry: { coordinates: [-68, 10, 10] },
    };
    const model = buildSitrep(
      [{ feed: "USGS", status: "ok", rawPayload: { features: [usgsFeat] } }, reliefWebOk(rwXml)],
      null,
      NOW,
    );
    const rw = model.surfaced.find((e) => e.feed === "ReliefWeb");
    expect(rw).toBeDefined();
    expect(rw!.duplicateOf).toBeUndefined();
  });

  // --- change detection through the seam (ADR 0009) ---

  it("annotates changes vs the prior snapshot passed through the seam", () => {
    // Run once to get a prior, then run again with a revised magnitude.
    const prior = buildSitrep([usgsOk], null, NOW);
    expect(prior.changeSummary).toBeNull(); // first run: no notes

    const revised = JSON.parse(JSON.stringify(fixture));
    const aaa1 = revised.features.find(
      (f: { id: string }) => f.id === "us7000aaa1",
    );
    aaa1.properties.mag = 7.6; // was 7.2 — material revision

    const model = buildSitrep(
      [{ feed: "USGS", status: "ok", rawPayload: revised }],
      prior,
      NOW,
    );
    const e = model.surfaced.find((x) => x.feedEventId === "us7000aaa1");
    expect(e!.change).toEqual({
      kind: "revised",
      note: "revised since yesterday: M 7.2 → M 7.6",
    });
    expect(model.changeSummary).toEqual({ new: 0, revised: 1, withdrawn: 0 });
  });

  it("does not report withdrawals for a feed that went unavailable this run", () => {
    // Prior run had USGS events surfaced; this run USGS is down. Its prior
    // events vanishing is the outage, not a retraction — must not be flagged
    // "possibly withdrawn" (CLAUDE.md #5: never overstate).
    const prior = buildSitrep([usgsOk], null, NOW);
    expect(prior.surfaced.length).toBeGreaterThan(0);

    const model = buildSitrep([usgsDown], prior, NOW);
    expect(model.degradation).toEqual([{ feed: "USGS", reason: "HTTP 503" }]);
    expect(model.withdrawn).toEqual([]);
    expect(model.changeSummary).toEqual({ new: 0, revised: 0, withdrawn: 0 });
  });
});
