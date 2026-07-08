import { describe, it, expect } from "vitest";
import { isValidEventTime, formatUtc } from "../src/time.js";

describe("isValidEventTime", () => {
  it("accepts ordinary epoch-ms values", () => {
    expect(isValidEventTime(0)).toBe(true);
    expect(isValidEventTime(1783300000000)).toBe(true);
    expect(isValidEventTime(-1783300000000)).toBe(true);
  });

  it("rejects NaN and non-finite values", () => {
    expect(isValidEventTime(NaN)).toBe(false);
    expect(isValidEventTime(Infinity)).toBe(false);
    expect(isValidEventTime(-Infinity)).toBe(false);
  });

  it("rejects times outside the valid JS Date range (±8.64e15)", () => {
    expect(isValidEventTime(8.64e15)).toBe(true); // exact boundary is valid
    expect(isValidEventTime(8.64e15 + 1)).toBe(false);
    expect(isValidEventTime(-8.64e15 - 1)).toBe(false);
  });
});

describe("formatUtc (safe — never throws)", () => {
  it("formats a valid time as UTC ISO", () => {
    expect(formatUtc(Date.UTC(2026, 6, 8, 0, 30))).toBe("2026-07-08T00:30:00.000Z");
  });

  it("degrades to a marker instead of throwing on out-of-range time", () => {
    expect(() => formatUtc(8.7e15)).not.toThrow();
    expect(formatUtc(8.7e15)).toBe("time unavailable");
  });

  it("degrades to a marker instead of throwing on NaN time", () => {
    expect(() => formatUtc(NaN)).not.toThrow();
    expect(formatUtc(NaN)).toBe("time unavailable");
  });
});
