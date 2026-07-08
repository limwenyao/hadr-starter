import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseUsgs } from "../src/feeds/usgs.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/usgs-all-day.json", import.meta.url), "utf8"),
);

describe("parseUsgs", () => {
  it("normalises every well-formed feature into an Event", () => {
    const events = parseUsgs(fixture);
    expect(events).toHaveLength(6);
  });

  it("maps USGS fields onto the Event shape", () => {
    const e = parseUsgs(fixture).find((e) => e.feedEventId === "us7000aaa1");
    expect(e).toBeDefined();
    expect(e).toMatchObject({
      feed: "USGS",
      feedEventId: "us7000aaa1",
      hazardType: "EQ",
      title: "M 7.2 - 100 km S of Suva, Fiji",
      locationName: "100 km S of Suva, Fiji",
      time: 1783300000000,
      sourceUrl: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000aaa1",
    });
    expect(e!.coordinates).toEqual({ lon: 178.4, lat: -19.1, depthKm: 550 });
    expect(e!.metrics).toEqual({ mag: 7.2, sig: 900, pagerAlert: undefined });
  });

  it("carries the PAGER alert when present", () => {
    const e = parseUsgs(fixture).find((e) => e.feedEventId === "us7000aaa5");
    expect(e!.metrics.pagerAlert).toBe("red");
  });

  it("keeps null-magnitude events (the noise floor drops them, not the parser)", () => {
    const e = parseUsgs(fixture).find((e) => e.feedEventId === "us7000aaa6");
    expect(e).toBeDefined();
    expect(e!.metrics.mag).toBeUndefined();
  });

  it("skips malformed features instead of throwing", () => {
    const valid = fixture.features[0];
    const events = parseUsgs({ features: [{ bogus: true }, null, valid] });
    expect(events).toHaveLength(1);
    expect(events[0].feedEventId).toBe("us7000aaa1");
  });

  it("returns [] for payloads without a features array", () => {
    expect(parseUsgs({})).toEqual([]);
    expect(parseUsgs(null)).toEqual([]);
    expect(parseUsgs("not json-shaped")).toEqual([]);
  });
});
