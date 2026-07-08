import { describe, it, expect, vi } from "vitest";
import {
  buildAssessmentPrompt,
  parseAssessmentResponse,
  fillAssessments,
  FALLBACK_ASSESSMENT,
  type AssessmentWriter,
} from "../src/assessment/writer.js";
import type { SitrepModel, SurfacedEvent } from "../src/types.js";

function surfaced(id: string, tier: SurfacedEvent["tier"], mag: number): SurfacedEvent {
  return {
    feed: "USGS",
    feedEventId: id,
    hazardType: "EQ",
    title: `M ${mag} - test quake ${id}`,
    locationName: "near Testville",
    time: 1783300000000,
    metrics: { mag },
    tier,
  };
}

function model(events: SurfacedEvent[]): SitrepModel {
  return { generatedAt: 1783310000000, surfaced: events, degradation: [] };
}

describe("buildAssessmentPrompt", () => {
  const events = [surfaced("id-a", "CRITICAL", 7.2), surfaced("id-b", "MODERATE", 4.6)];
  const prompt = buildAssessmentPrompt(events);

  it("includes each event's id, tier, and key metrics", () => {
    expect(prompt).toContain("id-a");
    expect(prompt).toContain("id-b");
    expect(prompt).toContain("CRITICAL");
    expect(prompt).toContain("7.2");
    expect(prompt).toContain("near Testville");
  });

  it("instructs grounding and JSON-array output", () => {
    expect(prompt.toLowerCase()).toContain("only the data provided");
    expect(prompt.toLowerCase()).toContain("json array");
  });
});

describe("parseAssessmentResponse", () => {
  it("parses a clean JSON array", () => {
    const map = parseAssessmentResponse(
      '[{"id":"id-a","assessment":"A strong quake."}]',
    );
    expect(map.get("id-a")).toBe("A strong quake.");
  });

  it("extracts the JSON array even when wrapped in prose or fences", () => {
    const map = parseAssessmentResponse(
      'Here you go:\n```json\n[{"id":"id-a","assessment":"Text."}]\n```\nDone.',
    );
    expect(map.get("id-a")).toBe("Text.");
  });

  it("ignores malformed entries and keeps valid ones", () => {
    const map = parseAssessmentResponse(
      '[{"id":"id-a","assessment":"Ok."},{"nope":true},{"id":"id-b"}]',
    );
    expect(map.size).toBe(1);
    expect(map.get("id-a")).toBe("Ok.");
  });

  it("returns an empty map when no JSON array is found", () => {
    expect(parseAssessmentResponse("Sorry, I cannot help.").size).toBe(0);
  });
});

describe("fillAssessments (never crash the run — ADR 0008 spirit)", () => {
  it("attaches assessments returned by the writer", async () => {
    const writer: AssessmentWriter = async () =>
      new Map([["id-a", "Narrative for A."]]);
    const out = await fillAssessments(model([surfaced("id-a", "HIGH", 5.8)]), writer);
    expect(out.surfaced[0].assessment).toBe("Narrative for A.");
  });

  it("falls back per-event when the writer omits an id", async () => {
    const writer: AssessmentWriter = async () =>
      new Map([["id-a", "Narrative for A."]]);
    const out = await fillAssessments(
      model([surfaced("id-a", "HIGH", 5.8), surfaced("id-b", "MODERATE", 4.6)]),
      writer,
    );
    expect(out.surfaced[1].assessment).toBe(FALLBACK_ASSESSMENT);
  });

  it("falls back for every event when the writer throws", async () => {
    const writer: AssessmentWriter = async () => {
      throw new Error("claude -p exited 1");
    };
    const out = await fillAssessments(model([surfaced("id-a", "HIGH", 5.8)]), writer);
    expect(out.surfaced[0].assessment).toBe(FALLBACK_ASSESSMENT);
  });

  it("does not call the writer when nothing surfaced", async () => {
    const writer = vi.fn<AssessmentWriter>();
    const out = await fillAssessments(model([]), writer);
    expect(writer).not.toHaveBeenCalled();
    expect(out.surfaced).toEqual([]);
  });

  it("does not mutate the input model", async () => {
    const input = model([surfaced("id-a", "HIGH", 5.8)]);
    await fillAssessments(input, async () => new Map([["id-a", "X"]]));
    expect(input.surfaced[0].assessment).toBeUndefined();
  });
});
