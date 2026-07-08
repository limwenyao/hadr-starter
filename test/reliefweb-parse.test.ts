import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseReliefWeb } from "../src/feeds/reliefweb.js";

const xml = readFileSync(
  new URL("./fixtures/reliefweb-disasters.xml", import.meta.url),
  "utf8",
);

describe("parseReliefWeb", () => {
  it("normalises every item into an Event", () => {
    expect(parseReliefWeb(xml)).toHaveLength(3);
  });

  it("maps RSS fields onto the Event shape", () => {
    const e = parseReliefWeb(xml).find((e) =>
      e.feedEventId.endsWith("eq-2026-000093-ven"),
    );
    expect(e).toBeDefined();
    expect(e).toMatchObject({
      feed: "ReliefWeb",
      feedEventId: "https://reliefweb.int/disaster/eq-2026-000093-ven",
      hazardType: "EQ", // from the GLIDE prefix
      title: "Venezuela: Earthquakes - Jun 2026",
      locationName: "Venezuela (Bolivarian Republic of)",
      sourceUrl: "https://reliefweb.int/disaster/eq-2026-000093-ven",
    });
    // Country-level only — never carries coordinates or severity metrics.
    expect(e!.coordinates).toBeUndefined();
    expect(e!.metrics).toEqual({});
    // The description is HTML with encoded entities; the extracted country must be
    // decoded and tag-free (no residual &lt;/&amp; or angle brackets).
    expect(e!.locationName).not.toMatch(/[<>]|&(lt|gt|amp);/);
  });

  it("derives hazardType from the GLIDE prefix", () => {
    const byLink = new Map(parseReliefWeb(xml).map((e) => [e.feedEventId, e]));
    expect(
      byLink.get("https://reliefweb.int/disaster/tc-2026-000100-phl")!.hazardType,
    ).toBe("TC");
  });

  it("parses the RFC-822 pubDate as UTC epoch ms", () => {
    const e = parseReliefWeb(xml).find((e) =>
      e.feedEventId.endsWith("eq-2026-000093-ven"),
    );
    expect(e!.time).toBe(Date.UTC(2026, 5, 24, 0, 0, 0));
  });

  it("falls back to the title prefix and 'unknown' hazard when tags are absent", () => {
    const e = parseReliefWeb(xml).find((e) => e.feedEventId.endsWith("sah"));
    expect(e).toBeDefined();
    expect(e!.locationName).toBe("Sahel"); // title before the colon
    expect(e!.hazardType).toBe("unknown"); // no GLIDE tag
  });

  it("handles a single <item> (parser yields an object, not an array)", () => {
    const single = `<rss><channel><item>
      <title>Chad: Floods - Jul 2026</title>
      <link>https://reliefweb.int/disaster/fl-2026-000200-tcd</link>
      <pubDate>Fri, 03 Jul 2026 00:00:00 +0000</pubDate>
      <description>&lt;div class="tag glide"&gt;Glide: FL-2026-000200-TCD&lt;/div&gt;</description>
    </item></channel></rss>`;
    const events = parseReliefWeb(single);
    expect(events).toHaveLength(1);
    expect(events[0].hazardType).toBe("FL");
  });

  it("skips items missing a link or an unparseable date", () => {
    const bad = `<rss><channel>
      <item><title>No link</title><pubDate>Fri, 03 Jul 2026 00:00:00 +0000</pubDate></item>
      <item><title>Bad date</title><link>https://reliefweb.int/disaster/x</link><pubDate>nonsense</pubDate></item>
    </channel></rss>`;
    expect(parseReliefWeb(bad)).toEqual([]);
  });

  it("returns [] for empty, non-XML, or channel-less payloads", () => {
    expect(parseReliefWeb("")).toEqual([]);
    expect(parseReliefWeb("not xml at all")).toEqual([]);
    expect(parseReliefWeb("<rss><channel></channel></rss>")).toEqual([]);
    expect(parseReliefWeb(null)).toEqual([]);
  });
});
