import { describe, it, expect } from "vitest";
import { FEED_SOURCES } from "../src/feeds/sources.js";

describe("FEED_SOURCES registry", () => {
  it("covers the three feeds in display order with complete fields", () => {
    expect(FEED_SOURCES.map((s) => s.feed)).toEqual(["USGS", "GDACS", "ReliefWeb"]);
    for (const s of FEED_SOURCES) {
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.homeLabel.length).toBeGreaterThan(0);
      expect(s.homeUrl).toMatch(/^https:\/\//);
      expect(s.feedUrl).toMatch(/^https:\/\//);
    }
  });
});
