import { describe, it, expect } from "vitest";
import { detectChanges } from "../src/core/changes.js";
import type { SitrepModel, SurfacedEvent, Tier } from "../src/types.js";

const NOW = new Date("2026-07-08T00:30:00Z");

function ev(over: Partial<SurfacedEvent> & { feedEventId: string }): SurfacedEvent {
  return {
    feed: "USGS",
    hazardType: "EQ",
    title: `Event ${over.feedEventId}`,
    locationName: "somewhere",
    coordinates: { lon: 10, lat: 10 },
    // 2 hours before NOW — comfortably inside the 24h feed window.
    time: NOW.getTime() - 2 * 60 * 60_000,
    metrics: { mag: 5.8 },
    tier: "HIGH" as Tier,
    ...over,
  };
}

function prior(events: SurfacedEvent[]): SitrepModel {
  return {
    generatedAt: NOW.getTime() - 24 * 60 * 60_000,
    surfaced: events,
    degradation: [],
    withdrawn: [],
    changeSummary: null,
  };
}

describe("detectChanges (ADR 0009 — latest state, note material changes)", () => {
  it("flags nothing when there is no prior snapshot (first run)", () => {
    const out = detectChanges([ev({ feedEventId: "a" })], null, NOW, new Set());
    expect(out.surfaced[0].change).toBeUndefined();
    expect(out.withdrawn).toEqual([]);
    expect(out.changeSummary).toBeNull();
  });

  it("marks events absent from the prior snapshot as new", () => {
    const out = detectChanges(
      [ev({ feedEventId: "old" }), ev({ feedEventId: "brand-new" })],
      prior([ev({ feedEventId: "old" })]),
      NOW,
      new Set(),
    );
    const byId = new Map(out.surfaced.map((e) => [e.feedEventId, e]));
    expect(byId.get("brand-new")!.change).toEqual({ kind: "new" });
    expect(byId.get("old")!.change).toBeUndefined();
    expect(out.changeSummary).toEqual({ new: 1, revised: 0, withdrawn: 0 });
  });

  it("notes a material magnitude revision", () => {
    const out = detectChanges(
      [ev({ feedEventId: "a", metrics: { mag: 5.1 } })],
      prior([ev({ feedEventId: "a", metrics: { mag: 5.8 } })]),
      NOW,
      new Set(),
    );
    expect(out.surfaced[0].change!.kind).toBe("revised");
    expect(out.surfaced[0].change!.note).toBe("revised since yesterday: M 5.8 → M 5.1");
    expect(out.changeSummary).toEqual({ new: 0, revised: 1, withdrawn: 0 });
  });

  it("notes a material magnitude revision at exactly a 0.1 step despite float imprecision", () => {
    // 4.6 - 4.5 === 0.09999999999999964 in IEEE-754, which is < MAG_REVISION_MIN
    // (0.1) — the most common revision size must not be silently dropped.
    const out = detectChanges(
      [ev({ feedEventId: "a", metrics: { mag: 4.6 } })],
      prior([ev({ feedEventId: "a", metrics: { mag: 4.5 } })]),
      NOW,
      new Set(),
    );
    expect(out.surfaced[0].change!.kind).toBe("revised");
    expect(out.surfaced[0].change!.note).toContain("M 4.5 → M 4.6");
    expect(out.changeSummary).toEqual({ new: 0, revised: 1, withdrawn: 0 });
  });

  it("ignores magnitude jitter below MAG_REVISION_MIN", () => {
    const out = detectChanges(
      [ev({ feedEventId: "a", metrics: { mag: 5.85 } })],
      prior([ev({ feedEventId: "a", metrics: { mag: 5.8 } })]),
      NOW,
      new Set(),
    );
    expect(out.surfaced[0].change).toBeUndefined();
    expect(out.changeSummary).toEqual({ new: 0, revised: 0, withdrawn: 0 });
  });

  it("notes a tier change", () => {
    const out = detectChanges(
      [ev({ feedEventId: "a", tier: "CRITICAL" })],
      prior([ev({ feedEventId: "a", tier: "HIGH" })]),
      NOW,
      new Set(),
    );
    expect(out.surfaced[0].change!.note).toBe("tier changed: HIGH → CRITICAL");
  });

  it("notes a GDACS alert level change", () => {
    const out = detectChanges(
      [ev({ feedEventId: "g", feed: "GDACS", metrics: { alertLevel: "red" } })],
      prior([ev({ feedEventId: "g", feed: "GDACS", metrics: { alertLevel: "orange" } })]),
      NOW,
      new Set(),
    );
    expect(out.surfaced[0].change!.note).toBe("alert level: orange → red");
  });

  it("joins multiple material changes into one note", () => {
    const out = detectChanges(
      [ev({ feedEventId: "a", tier: "CRITICAL", metrics: { mag: 6.6 } })],
      prior([ev({ feedEventId: "a", tier: "HIGH", metrics: { mag: 5.8 } })]),
      NOW,
      new Set(),
    );
    expect(out.surfaced[0].change!.note).toBe(
      "revised since yesterday: M 5.8 → M 6.6; tier changed: HIGH → CRITICAL",
    );
  });

  it("does not match events across feeds (identity is feed + id)", () => {
    const out = detectChanges(
      [ev({ feedEventId: "same-id", feed: "GDACS", metrics: { alertLevel: "red" } })],
      prior([ev({ feedEventId: "same-id", feed: "USGS", metrics: { mag: 5.8 } })]),
      NOW,
      new Set(),
    );
    expect(out.surfaced[0].change).toEqual({ kind: "new" });
  });

  it("flags a vanished event still inside the feed window as possibly withdrawn", () => {
    const out = detectChanges(
      [],
      prior([ev({ feedEventId: "gone", title: "M 5.8 - gone quake" })]),
      NOW,
      new Set(),
    );
    expect(out.withdrawn).toEqual([
      {
        feed: "USGS",
        feedEventId: "gone",
        note: "no longer listed by USGS since yesterday (possibly withdrawn): M 5.8 - gone quake",
      },
    ]);
    expect(out.changeSummary).toEqual({ new: 0, revised: 0, withdrawn: 1 });
  });

  it("does NOT flag an event that naturally aged out of the feed window", () => {
    const aged = ev({
      feedEventId: "aged",
      time: NOW.getTime() - 30 * 60 * 60_000, // 30h ago — outside 24h window
    });
    const out = detectChanges([], prior([aged]), NOW, new Set());
    expect(out.withdrawn).toEqual([]);
    expect(out.changeSummary).toEqual({ new: 0, revised: 0, withdrawn: 0 });
  });

  it("does not mutate its inputs", () => {
    const current = [ev({ feedEventId: "brand-new" })];
    const p = prior([]);
    detectChanges(current, p, NOW, new Set());
    expect(current[0].change).toBeUndefined();
  });

  it("does NOT flag a vanished event as withdrawn when its feed was unavailable this run", () => {
    // The feed being down is why its prior events are missing — that is an
    // outage, not a retraction (CLAUDE.md #5: never overstate).
    const out = detectChanges(
      [],
      prior([ev({ feedEventId: "gone", title: "M 5.8 - gone quake" })]),
      NOW,
      new Set(["USGS"]),
    );
    expect(out.withdrawn).toEqual([]);
    expect(out.changeSummary).toEqual({ new: 0, revised: 0, withdrawn: 0 });
  });

  it("still flags withdrawal when the feed was available but the event is simply gone", () => {
    // Contrast case: preserves existing behavior when unavailableFeeds is empty.
    const out = detectChanges(
      [],
      prior([ev({ feedEventId: "gone", title: "M 5.8 - gone quake" })]),
      NOW,
      new Set(),
    );
    expect(out.withdrawn).toHaveLength(1);
    expect(out.changeSummary).toEqual({ new: 0, revised: 0, withdrawn: 1 });
  });
});
