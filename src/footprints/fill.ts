import type { FeatureCollection } from "geojson";
import type { FootprintResult, SitrepModel, SurfacedEvent } from "../types.js";
import { FOOTPRINT_FETCH_CONCURRENCY } from "../thresholds.js";

/** Networked footprint fetch, injected so the seam stays testable (no network in tests). */
export interface FootprintSource {
  /** Never throws in production; fillFootprints also guards. undefined = no zone. */
  forEvent(event: SurfacedEvent): Promise<FootprintResult | undefined>;
}

/** Composite identity — space separator, matching src/core/changes.ts. */
export function footprintKey(event: { feed: string; feedEventId: string }): string {
  return `${event.feed} ${event.feedEventId}`;
}

/**
 * Attach a FootprintSummary to each surfaced event and collect normalized
 * geometry keyed by footprint key. Never throws: a source failure per event
 * degrades that event to no zone (CLAUDE.md #4). Returns a fresh model.
 */
export async function fillFootprints(
  model: SitrepModel,
  source: FootprintSource,
): Promise<{ model: SitrepModel; geometryById: Record<string, FeatureCollection> }> {
  if (model.surfaced.length === 0) return { model: { ...model }, geometryById: {} };

  const geometryById: Record<string, FeatureCollection> = {};

  async function processOne(e: SurfacedEvent): Promise<SurfacedEvent> {
    let result: FootprintResult | undefined;
    try {
      result = await source.forEvent(e);
      // Malformed geometry from a FootprintSource degrades this one event to
      // no zone rather than rejecting the whole batch (CLAUDE.md #4).
      if (result?.geometry && Array.isArray(result.geometry.features)) {
        const key = footprintKey(e);
        // Stamp the key onto every feature so the client can filter by eventId.
        geometryById[key] = {
          type: "FeatureCollection",
          features: result.geometry.features.map((f) => ({
            ...f,
            properties: { ...(f.properties ?? {}), eventId: key },
          })),
        };
      }
    } catch (err) {
      console.error(`footprint fetch failed for ${footprintKey(e)}: ${String(err)}`);
      result = undefined;
    }
    if (!result) return { ...e };
    return { ...e, footprint: result.summary };
  }

  // Process in sequential batches so we never burst more than
  // FOOTPRINT_FETCH_CONCURRENCY concurrent requests at a feed (poll politely,
  // ADR 0008). Batches run in order and are concatenated in order, so the
  // output array's order always matches model.surfaced.
  const surfaced: SurfacedEvent[] = [];
  for (let i = 0; i < model.surfaced.length; i += FOOTPRINT_FETCH_CONCURRENCY) {
    const batch = model.surfaced.slice(i, i + FOOTPRINT_FETCH_CONCURRENCY);
    surfaced.push(...(await Promise.all(batch.map(processOne))));
  }

  return { model: { ...model, surfaced }, geometryById };
}
