import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseGdacs } from "../src/feeds/gdacs.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/gdacs-events.json", import.meta.url), "utf8"),
);

describe("parseGdacs", () => {
  it("normalises every well-formed feature into an Event", () => {
    expect(parseGdacs(fixture)).toHaveLength(4);
  });

  it("maps GDACS fields onto the Event shape", () => {
    const e = parseGdacs(fixture).find((e) => e.feedEventId === "1550421");
    expect(e).toBeDefined();
    expect(e).toMatchObject({
      feed: "GDACS",
      feedEventId: "1550421",
      hazardType: "EQ",
      title: "Earthquake in Japan",
      locationName: "Japan",
      sourceUrl:
        "https://www.gdacs.org/report.aspx?eventid=1550421&episodeid=1716583&eventtype=EQ",
    });
    expect(e!.coordinates).toEqual({ lon: 141.845, lat: 40.4353 });
    // GDACS magnitude is not extracted from prose — alert level drives tiering.
    expect(e!.metrics.mag).toBeUndefined();
  });

  it("normalises the alert level to lowercase (GDACS alert level, not PAGER)", () => {
    const byId = new Map(parseGdacs(fixture).map((e) => [e.feedEventId, e]));
    expect(byId.get("1550421")!.metrics.alertLevel).toBe("green");
    expect(byId.get("1550500")!.metrics.alertLevel).toBe("orange");
    expect(byId.get("1550600")!.metrics.alertLevel).toBe("red");
    // alertLevel and pagerAlert are distinct fields; GDACS never sets pagerAlert.
    expect(byId.get("1550600")!.metrics.pagerAlert).toBeUndefined();
  });

  it("parses the offset-less fromdate as UTC (not host local time)", () => {
    const e = parseGdacs(fixture).find((e) => e.feedEventId === "1550421");
    expect(e!.time).toBe(Date.UTC(2026, 6, 6, 11, 29, 36));
  });

  it("carries the multi-hazard event type (EQ / TC / FL ...)", () => {
    const types = parseGdacs(fixture).map((e) => e.hazardType);
    expect(types).toEqual(expect.arrayContaining(["EQ", "TC", "FL"]));
  });

  it("falls back to a placeholder when country is missing", () => {
    const e = parseGdacs(fixture).find((e) => e.feedEventId === "1550700");
    expect(e!.locationName).toBe("location unknown");
  });

  const feature = (props: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [1, 2] },
    properties: {
      eventtype: "EQ",
      eventid: 999,
      name: "Test",
      alertlevel: "Red",
      country: "Testland",
      fromdate: "2026-07-06T00:00:00",
      ...props,
    },
    ...over,
  });

  it("skips a feature with no usable eventid", () => {
    expect(parseGdacs({ features: [feature({ eventid: null })] })).toEqual([]);
  });

  it("skips a feature whose fromdate is missing or unparseable", () => {
    expect(parseGdacs({ features: [feature({ fromdate: undefined })] })).toEqual([]);
    expect(parseGdacs({ features: [feature({ fromdate: "not-a-date" })] })).toEqual([]);
  });

  it("skips an unrecognised alert level rather than inventing one", () => {
    const e = parseGdacs({ features: [feature({ alertlevel: "Chartreuse" })] });
    expect(e[0].metrics.alertLevel).toBeUndefined();
  });

  it("keeps a feature with missing geometry (coordinates undefined)", () => {
    const e = parseGdacs({ features: [feature({}, { geometry: null })] });
    expect(e).toHaveLength(1);
    expect(e[0].coordinates).toBeUndefined();
  });

  it("skips primitive (non-object) feature entries instead of throwing", () => {
    const events = parseGdacs({ features: [42, "quake", true, feature({})] });
    expect(events).toHaveLength(1);
    expect(events[0].feedEventId).toBe("999");
  });

  it("returns [] for payloads without a features array", () => {
    expect(parseGdacs({})).toEqual([]);
    expect(parseGdacs(null)).toEqual([]);
    expect(parseGdacs("not json-shaped")).toEqual([]);
  });
});
