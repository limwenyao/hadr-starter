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

  const feature = (props: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    id: "us-test",
    properties: { time: 1783300000000, ...props },
    geometry: { coordinates: [1, 2, 3] },
    ...over,
  });

  it("skips a feature whose time is not a number", () => {
    expect(parseUsgs({ features: [feature({ time: "2026-01-01" })] })).toEqual([]);
    expect(parseUsgs({ features: [feature({ time: null })] })).toEqual([]);
  });

  it("skips a feature whose time is NaN or out of the valid Date range", () => {
    expect(parseUsgs({ features: [feature({ time: NaN })] })).toEqual([]);
    expect(parseUsgs({ features: [feature({ time: 8.7e15 })] })).toEqual([]);
  });

  it("keeps a feature with missing/invalid geometry (coordinates undefined)", () => {
    const noGeom = parseUsgs({ features: [feature({}, { geometry: null })] });
    expect(noGeom).toHaveLength(1);
    expect(noGeom[0].coordinates).toBeUndefined();

    const badCoords = parseUsgs({
      features: [feature({}, { geometry: { coordinates: "nope" } })],
    });
    expect(badCoords[0].coordinates).toBeUndefined();
  });

  it("skips primitive (non-object) features entries instead of throwing", () => {
    const events = parseUsgs({ features: [42, "quake", true, feature({})] });
    expect(events).toHaveLength(1);
    expect(events[0].feedEventId).toBe("us-test");
  });

  it("captures the detail URL as footprintRef", () => {
    const payload = { features: [{
      id: "uw123", properties: {
        mag: 5.1, place: "x", time: Date.UTC(2026, 6, 9),
        detail: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/uw123.geojson",
      }, geometry: { coordinates: [1, 2, 10] },
    }] };
    expect(parseUsgs(payload)[0].footprintRef)
      .toBe("https://earthquake.usgs.gov/earthquakes/feed/v1.0/detail/uw123.geojson");
  });

  it("leaves footprintRef undefined when detail is missing or non-string", () => {
    const payload = { features: [{
      id: "uw123", properties: { mag: 5.1, place: "x", time: Date.UTC(2026, 6, 9), detail: 42 },
      geometry: { coordinates: [1, 2] },
    }] };
    expect(parseUsgs(payload)[0].footprintRef).toBeUndefined();
  });
});
