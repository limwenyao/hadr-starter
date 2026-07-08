import { describe, it, expect } from "vitest";
import { passesNoiseFloor, tierFor } from "../src/core/triage.js";
import type { Event, PagerAlert } from "../src/types.js";

function usgsEvent(mag: number | undefined, pagerAlert?: PagerAlert): Event {
  return {
    feed: "USGS",
    feedEventId: `test-${mag ?? "null"}-${pagerAlert ?? "none"}`,
    hazardType: "EQ",
    title: "test quake",
    locationName: "somewhere",
    time: 1783300000000,
    metrics: { mag, pagerAlert },
  };
}

describe("passesNoiseFloor (ADR 0004: conservative/loud)", () => {
  it("surfaces USGS M >= 4.5", () => {
    expect(passesNoiseFloor(usgsEvent(4.5))).toBe(true);
    expect(passesNoiseFloor(usgsEvent(7.2))).toBe(true);
  });

  it("drops USGS M < 4.5", () => {
    expect(passesNoiseFloor(usgsEvent(4.49))).toBe(false);
    expect(passesNoiseFloor(usgsEvent(3.0))).toBe(false);
  });

  it("drops null-magnitude events without a critical PAGER alert", () => {
    expect(passesNoiseFloor(usgsEvent(undefined))).toBe(false);
  });

  it("surfaces PAGER orange/red regardless of magnitude (never miss a major event)", () => {
    expect(passesNoiseFloor(usgsEvent(4.2, "red"))).toBe(true);
    expect(passesNoiseFloor(usgsEvent(undefined, "orange"))).toBe(true);
  });

  it("does not let PAGER green/yellow bypass the magnitude floor", () => {
    expect(passesNoiseFloor(usgsEvent(4.2, "green"))).toBe(false);
    expect(passesNoiseFloor(usgsEvent(4.2, "yellow"))).toBe(false);
  });
});

describe("tierFor (ADR 0004: three-tier unified priority)", () => {
  it("CRITICAL at M >= 6.5", () => {
    expect(tierFor(usgsEvent(6.5))).toBe("CRITICAL");
    expect(tierFor(usgsEvent(7.2))).toBe("CRITICAL");
  });

  it("CRITICAL on PAGER orange/red even at mid magnitude (impact-aware)", () => {
    expect(tierFor(usgsEvent(4.8, "red"))).toBe("CRITICAL");
    expect(tierFor(usgsEvent(5.0, "orange"))).toBe("CRITICAL");
  });

  it("HIGH at M 5.5-6.4", () => {
    expect(tierFor(usgsEvent(5.5))).toBe("HIGH");
    expect(tierFor(usgsEvent(6.4))).toBe("HIGH");
  });

  it("MODERATE at M 4.5-5.4", () => {
    expect(tierFor(usgsEvent(4.5))).toBe("MODERATE");
    expect(tierFor(usgsEvent(5.4))).toBe("MODERATE");
  });

  it("PAGER green/yellow does not promote", () => {
    expect(tierFor(usgsEvent(5.8, "yellow"))).toBe("HIGH");
    expect(tierFor(usgsEvent(4.6, "green"))).toBe("MODERATE");
  });
});
