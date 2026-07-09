import type { SitrepModel, SurfacedEvent } from "../types.js";

const SEVERITY = { CRITICAL: 0, HIGH: 1, MODERATE: 2 } as const;

/** Synthesise a SitrepModel from DB rows for the render path (slice 1: no
 *  degradation/withdrawn/change data — those come from ingest_runs later). */
export function buildDbSitrepModel(events: SurfacedEvent[], now: Date): SitrepModel {
  const surfaced = [...events].sort(
    (a, b) => SEVERITY[a.tier] - SEVERITY[b.tier] || (b.metrics.mag ?? 0) - (a.metrics.mag ?? 0),
  );
  return {
    generatedAt: now.getTime(),
    surfaced,
    degradation: [],
    withdrawn: [],
    changeSummary: null,
  };
}
