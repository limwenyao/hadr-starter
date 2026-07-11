import { describe, it, expect } from "vitest";
import { buildViewModel } from "../src/render/viewModel.js";
import type { SitrepModel, SurfacedEvent } from "../src/types.js";
import type { FetchStatus } from "../src/types.js";

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
  it("stamps run metadata: generated time, total count", () => {
    const vm = buildViewModel(model({ surfaced: [surfaced({})] }));
    expect(vm.generatedUtc).toBe("2026-07-08T00:30:00.000Z");
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

  const recencyOf = (ageMs: number) => {
    const gen = Date.UTC(2026, 6, 9, 12, 0);
    const vm = buildViewModel(model({
      generatedAt: gen,
      surfaced: [surfaced({ sourceUpdatedAt: gen - ageMs, updateProvenance: "source" })],
    }));
    return vm.tiers[0].events[0].updatedRecency;
  };

  it("computes source-updated fields with a colour-coded recency bucket", () => {
    const gen = Date.UTC(2026, 6, 9, 12, 0);
    const card = buildViewModel(model({
      generatedAt: gen,
      surfaced: [surfaced({ sourceUpdatedAt: gen - 2 * 3600_000, updateProvenance: "source" })],
    })).tiers[0].events[0];
    expect(card.sourceUpdatedAgeLabel).toBe("~2h ago");
    expect(card.updateProvenance).toBe("source");
    expect(card.updatedRecency).toBe("recent");
  });

  it("buckets updatedRecency: fresh <60m, recent <24h, stale beyond", () => {
    expect(recencyOf(30 * 60_000)).toBe("fresh");   // 30 min
    expect(recencyOf(60 * 60_000)).toBe("recent");  // exactly 60 min → not fresh
    expect(recencyOf(2 * 3600_000)).toBe("recent"); // 2 h
    expect(recencyOf(24 * 3600_000)).toBe("stale");  // exactly 24 h → not recent
    expect(recencyOf(48 * 3600_000)).toBe("stale");  // 2 d
  });

  it("falls back to event time + 'inferred' when no source update time", () => {
    const gen = Date.UTC(2026, 6, 9, 12, 0);
    const card = buildViewModel(model({
      generatedAt: gen,
      surfaced: [surfaced({ time: gen - 3600_000, sourceUpdatedAt: undefined, updateProvenance: undefined })],
    })).tiers[0].events[0];
    expect(card.updateProvenance).toBe("inferred");
    expect(card.updatedRecency).toBe("recent");
  });
});

const GEN = Date.UTC(2026, 6, 8, 0, 30); // matches model() generatedAt

function fetchStatus(over: Partial<FetchStatus> = {}): FetchStatus {
  return { latestRunAt: GEN, latestFeedsOk: ["USGS", "GDACS", "ReliefWeb"], lastOkByFeed: {}, ...over };
}

describe("buildViewModel — data sources", () => {
  it("lists the three feeds in registry order", () => {
    const vm = buildViewModel(model({}), fetchStatus());
    expect(vm.dataSources.map((s) => s.feed)).toEqual(["USGS", "GDACS", "ReliefWeb"]);
  });

  it("bands the last-successful-fetch age: fresh <60m, recent <24h, stale >=24h", () => {
    const vm = buildViewModel(model({}), fetchStatus({
      lastOkByFeed: {
        USGS: GEN - 10 * 60_000,        // 10m -> fresh
        GDACS: GEN - 5 * 60 * 60_000,   // 5h  -> recent
        ReliefWeb: GEN - 30 * 60 * 60_000, // 30h -> stale
      },
    }));
    const [u, g, r] = vm.dataSources;
    expect([u.recency, g.recency, r.recency]).toEqual(["fresh", "recent", "stale"]);
    expect(u.updatedAgeLabel).toBe("~10m ago");
    expect(r.updatedAgeLabel).toBe("~30h ago");
  });

  it("never-fetched feed -> null age/recency, everFetched false", () => {
    const vm = buildViewModel(model({}), fetchStatus({ lastOkByFeed: { USGS: GEN } }));
    const g = vm.dataSources.find((s) => s.feed === "GDACS")!;
    expect(g.everFetched).toBe(false);
    expect(g.updatedAgeLabel).toBeNull();
    expect(g.recency).toBeNull();
    expect(g.updatedUtc).toBeNull();
  });

  it("failed-latest-run feed gets a failure note with the run time; ok feeds do not", () => {
    const vm = buildViewModel(model({}), fetchStatus({
      latestFeedsOk: ["USGS", "GDACS"],
      lastOkByFeed: { USGS: GEN, GDACS: GEN, ReliefWeb: GEN - 24 * 60 * 60_000 },
    }));
    const r = vm.dataSources.find((s) => s.feed === "ReliefWeb")!;
    const u = vm.dataSources.find((s) => s.feed === "USGS")!;
    expect(r.failureNote).toBe("Failed to fetch updates at 2026-07-08T00:30:00.000Z");
    expect(u.failureNote).toBeNull();
  });

  it("exposes the latest run time as lastFetchAttemptUtc", () => {
    const vm = buildViewModel(model({}), fetchStatus({ latestRunAt: Date.UTC(2026, 6, 8, 6, 0) }));
    expect(vm.lastFetchAttemptUtc).toBe("2026-07-08T06:00:00.000Z");
    expect(vm.dataSourcesStatusAvailable).toBe(true);
  });

  it("null fetch status -> status unavailable, no attempt time, null recency", () => {
    const vm = buildViewModel(model({}), null);
    expect(vm.dataSourcesStatusAvailable).toBe(false);
    expect(vm.lastFetchAttemptUtc).toBeNull();
    expect(vm.dataSources).toHaveLength(3);
    expect(vm.dataSources.every((s) => s.recency === null)).toBe(true);
  });

  it("dataSourcesSubtext: null fetchStatus -> 'Fetch status unavailable'", () => {
    const vm = buildViewModel(model({}), null);
    expect(vm.dataSourcesSubtext).toBe("Fetch status unavailable");
  });

  it("dataSourcesSubtext: fetchStatus with latestRunAt null -> 'No runs recorded yet'", () => {
    const vm = buildViewModel(
      model({}),
      { latestRunAt: null, latestFeedsOk: [], lastOkByFeed: {} },
    );
    expect(vm.dataSourcesSubtext).toBe("No runs recorded yet");
  });

  it("dataSourcesSubtext: fetchStatus with latestRunAt set -> 'Last fetch attempt: ' + formatUtc", () => {
    const vm = buildViewModel(model({}), fetchStatus({ latestRunAt: Date.UTC(2026, 6, 8, 6, 0) }));
    expect(vm.dataSourcesSubtext).toBe("Last fetch attempt: 2026-07-08T06:00:00.000Z");
  });
});
