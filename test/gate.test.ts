import { describe, it, expect } from "vitest";
import { shouldAssess, carryForwardAssessments } from "../src/assessment/gate.js";
import { FALLBACK_ASSESSMENT } from "../src/assessment/writer.js";
import type { SitrepModel, SurfacedEvent } from "../src/types.js";

describe("shouldAssess (deterministic quiet-gate — rules decide, not the model)", () => {
  it("assesses when forced, regardless of the verdict", () => {
    expect(shouldAssess({ new: 0, revised: 0, withdrawn: 0 }, true)).toBe(true);
  });

  it("assesses on the first run (no prior snapshot → null verdict)", () => {
    expect(shouldAssess(null, false)).toBe(true);
  });

  it("assesses when any of new/revised/withdrawn is non-zero", () => {
    expect(shouldAssess({ new: 1, revised: 0, withdrawn: 0 }, false)).toBe(true);
    expect(shouldAssess({ new: 0, revised: 2, withdrawn: 0 }, false)).toBe(true);
    expect(shouldAssess({ new: 0, revised: 0, withdrawn: 3 }, false)).toBe(true);
  });

  it("stays quiet when nothing changed and not forced", () => {
    expect(shouldAssess({ new: 0, revised: 0, withdrawn: 0 }, false)).toBe(false);
  });
});

function surfaced(id: string, over: Partial<SurfacedEvent> = {}): SurfacedEvent {
  return {
    feed: "USGS",
    feedEventId: id,
    hazardType: "EQ",
    title: `M 5.8 - quake ${id}`,
    locationName: "near Testville",
    time: 1783300000000,
    metrics: { mag: 5.8 },
    tier: "HIGH",
    ...over,
  };
}

function model(events: SurfacedEvent[]): SitrepModel {
  return {
    generatedAt: 1783310000000,
    surfaced: events,
    degradation: [],
    withdrawn: [],
    changeSummary: { new: 0, revised: 0, withdrawn: 0 },
  };
}

describe("carryForwardAssessments (quiet day — reuse prior prose, no model call)", () => {
  it("copies prior assessment prose by feedEventId", () => {
    const prior = model([surfaced("a", { assessment: "Yesterday's prose for A." })]);
    const out = carryForwardAssessments(model([surfaced("a")]), prior);
    expect(out.surfaced[0].assessment).toBe("Yesterday's prose for A.");
  });

  it("falls back per-event when the prior lacks that id", () => {
    const prior = model([surfaced("a", { assessment: "A." })]);
    const out = carryForwardAssessments(model([surfaced("b")]), prior);
    expect(out.surfaced[0].assessment).toBe(FALLBACK_ASSESSMENT);
  });

  it("falls back for every event when there is no prior snapshot", () => {
    const out = carryForwardAssessments(model([surfaced("a"), surfaced("b")]), null);
    expect(out.surfaced.map((e) => e.assessment)).toEqual([
      FALLBACK_ASSESSMENT,
      FALLBACK_ASSESSMENT,
    ]);
  });

  it("returns a fresh object and does not mutate the input", () => {
    const input = model([surfaced("a")]);
    const prior = model([surfaced("a", { assessment: "A." })]);
    const out = carryForwardAssessments(input, prior);
    expect(out).not.toBe(input);
    expect(input.surfaced[0].assessment).toBeUndefined();
  });
});
