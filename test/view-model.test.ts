import { describe, it, expect } from "vitest";
import { buildViewModel } from "../src/render/viewModel.js";
import type { SitrepModel, SurfacedEvent } from "../src/types.js";

function surfaced(over: Partial<SurfacedEvent>): SurfacedEvent {
  return {
    feed: "USGS",
    feedEventId: "id-x",
    hazardType: "EQ",
    title: "M 5.8 - test quake",
    locationName: "near Testville",
    coordinates: { lon: 178.4, lat: -19.1, depthKm: 550 },
    time: Date.UTC(2026, 6, 8, 0, 15),
    metrics: { mag: 5.8 },
    tier: "HIGH",
    assessment: "A strong quake near Testville.",
    ...over,
  };
}

function model(over: Partial<SitrepModel>): SitrepModel {
  return {
    generatedAt: Date.UTC(2026, 6, 8, 0, 30),
    surfaced: [],
    degradation: [],
    withdrawn: [],
    changeSummary: null,
    ...over,
  };
}

describe("buildViewModel (all render logic lives here — client stays dumb)", () => {
  it("stamps run metadata: generated time, feeds line, total count", () => {
    const vm = buildViewModel(model({ surfaced: [surfaced({})] }));
    expect(vm.generatedUtc).toBe("2026-07-08T00:30:00.000Z");
    expect(vm.feedsLine).toBe("USGS, GDACS, ReliefWeb");
    expect(vm.totalCount).toBe(1);
  });

  it("groups events by tier in severity order, skipping empty tiers", () => {
    const vm = buildViewModel(
      model({
        surfaced: [
          surfaced({ feedEventId: "m", tier: "MODERATE" }),
          surfaced({ feedEventId: "c", tier: "CRITICAL" }),
        ],
      }),
    );
    expect(vm.tiers.map((t) => t.tier)).toEqual(["CRITICAL", "MODERATE"]);
    expect(vm.tiers.map((t) => t.count)).toEqual([1, 1]);
  });

  it("builds badge strings: hazard (non-EQ only), M, PAGER, alert, sig", () => {
    const vm = buildViewModel(
      model({
        surfaced: [
          surfaced({
            hazardType: "TC",
            metrics: { mag: 7.2, sig: 900, pagerAlert: "red", alertLevel: "orange" },
          }),
        ],
      }),
    );
    expect(vm.tiers[0].events[0].badges).toEqual([
      "TC",
      "M 7.2",
      "PAGER red",
      "alert orange",
      "sig 900",
    ]);
  });

  it("omits the hazard badge for EQ and absent metrics", () => {
    const vm = buildViewModel(model({ surfaced: [surfaced({})] }));
    expect(vm.tiers[0].events[0].badges).toEqual(["M 5.8"]);
  });

  it("formats event time via the safe formatter (out-of-range degrades)", () => {
    const vm = buildViewModel(model({ surfaced: [surfaced({ time: 8.7e15 })] }));
    expect(vm.tiers[0].events[0].timeUtc).toBe("time unavailable");
  });

  it("sanitizes sourceUrl server-side: http(s) kept, other schemes null", () => {
    const bad = buildViewModel(
      model({ surfaced: [surfaced({ sourceUrl: "javascript:alert(1)" })] }),
    );
    expect(bad.tiers[0].events[0].sourceUrl).toBeNull();
    const good = buildViewModel(
      model({ surfaced: [surfaced({ sourceUrl: "https://example.org/x" })] }),
    );
    expect(good.tiers[0].events[0].sourceUrl).toBe("https://example.org/x");
  });

  it("carries coordinates as lon/lat or null (ReliefWeb is list-only)", () => {
    const vm = buildViewModel(
      model({
        surfaced: [
          surfaced({ feedEventId: "has" }),
          surfaced({ feedEventId: "none", feed: "ReliefWeb", coordinates: undefined }),
        ],
      }),
    );
    const byId = new Map(vm.tiers[0].events.map((e) => [e.id, e]));
    expect(byId.get("has")!.coordinates).toEqual({ lon: 178.4, lat: -19.1 });
    expect(byId.get("none")!.coordinates).toBeNull();
  });

  it("builds the duplicate note string, null when unflagged", () => {
    const vm = buildViewModel(
      model({
        surfaced: [
          surfaced({
            duplicateOf: { feed: "USGS", feedEventId: "u1", title: "USGS quake" },
          }),
          surfaced({ feedEventId: "plain" }),
        ],
      }),
    );
    const notes = vm.tiers[0].events.map((e) => e.duplicateNote);
    expect(notes).toContain("Likely the same event as USGS — USGS quake");
    expect(notes).toContain(null);
  });

  it("defaults a missing assessment to an empty string", () => {
    const vm = buildViewModel(model({ surfaced: [surfaced({ assessment: undefined })] }));
    expect(vm.tiers[0].events[0].assessment).toBe("");
  });

  it("passes change flags through: isNew, isUpdated, changeNote", () => {
    const vm = buildViewModel(
      model({
        surfaced: [
          surfaced({ feedEventId: "n", change: { kind: "new" } }),
          surfaced({
            feedEventId: "r",
            change: { kind: "revised", note: "revised since yesterday: M 5.8 → M 5.1" },
          }),
          surfaced({ feedEventId: "u" }),
        ],
      }),
    );
    const byId = new Map(vm.tiers[0].events.map((e) => [e.id, e]));
    expect(byId.get("n")).toMatchObject({ isNew: true, isUpdated: false, changeNote: null });
    expect(byId.get("r")).toMatchObject({
      isNew: false,
      isUpdated: true,
      changeNote: "revised since yesterday: M 5.8 → M 5.1",
    });
    expect(byId.get("u")).toMatchObject({ isNew: false, isUpdated: false, changeNote: null });
  });

  it("builds the changes line from the summary, null on first runs", () => {
    const withSummary = buildViewModel(
      model({ changeSummary: { new: 3, revised: 1, withdrawn: 2 } }),
    );
    expect(withSummary.changesLine).toBe(
      "since yesterday: 3 new · 1 revised · 2 possibly withdrawn",
    );
    expect(buildViewModel(model({})).changesLine).toBeNull();
  });

  it("passes withdrawn notes through as plain strings", () => {
    const vm = buildViewModel(
      model({
        withdrawn: [
          { feed: "USGS", feedEventId: "gone", note: "no longer listed by USGS…" },
        ],
      }),
    );
    expect(vm.withdrawn).toEqual(["no longer listed by USGS…"]);
  });

  it("passes degradation notices through", () => {
    const vm = buildViewModel(
      model({ degradation: [{ feed: "ReliefWeb", reason: "HTTP 406" }] }),
    );
    expect(vm.degradation).toEqual([{ feed: "ReliefWeb", reason: "HTTP 406" }]);
    expect(vm.totalCount).toBe(0);
    expect(vm.tiers).toEqual([]);
  });

  it("carries a composite footprint key and the footprint summary onto the card", () => {
    const vm = buildViewModel(model({
      surfaced: [surfaced({
        feed: "GDACS", feedEventId: "42",
        footprint: { provenance: "gdacs", label: "Modeled affected area (GDACS · earthquake)", isEstimate: false, radiusKm: 50 },
      })],
    }));
    const card = vm.tiers[0].events[0];
    expect(card.key).toBe("GDACS 42");
    expect(card.footprint!.label).toContain("GDACS");
  });

  it("sets card.footprint to null when the event has no footprint", () => {
    const vm = buildViewModel(model({ surfaced: [surfaced({})] }));
    expect(vm.tiers[0].events[0].footprint).toBeNull();
  });

  it("computes source-updated fields and a stale hint past the threshold", () => {
    const gen = Date.UTC(2026, 6, 9, 12, 0);
    const vm = buildViewModel(model({
      generatedAt: gen,
      surfaced: [surfaced({ sourceUpdatedAt: gen - 2 * 3600_000, updateProvenance: "source" })],
    }));
    const card = vm.tiers[0].events[0];
    expect(card.sourceUpdatedUtc).toBe("2026-07-09T10:00:00.000Z");
    expect(card.sourceUpdatedAgeLabel).toBe("~2h ago");
    expect(card.updateProvenance).toBe("source");
    expect(card.stalenessHint).toBe(false);
  });

  it("flags stalenessHint when the source update is older than STALE_AFTER_MS", () => {
    const gen = Date.UTC(2026, 6, 9, 12, 0);
    const vm = buildViewModel(model({
      generatedAt: gen,
      surfaced: [surfaced({ sourceUpdatedAt: gen - 48 * 3600_000, updateProvenance: "source" })],
    }));
    expect(vm.tiers[0].events[0].stalenessHint).toBe(true);
  });

  it("falls back to event time + 'inferred' when no source update time", () => {
    const gen = Date.UTC(2026, 6, 9, 12, 0);
    const vm = buildViewModel(model({
      generatedAt: gen,
      surfaced: [surfaced({ time: gen - 3600_000, sourceUpdatedAt: undefined, updateProvenance: undefined })],
    }));
    const card = vm.tiers[0].events[0];
    expect(card.updateProvenance).toBe("inferred");
    expect(card.sourceUpdatedUtc).toBe("2026-07-09T11:00:00.000Z");
  });
});
