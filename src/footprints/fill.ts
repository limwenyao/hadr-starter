import type { FeatureCollection } from "geojson";
import type { FootprintResult, SitrepModel, SurfacedEvent } from "../types.js";

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
  const surfaced = await Promise.all(
    model.surfaced.map(async (e) => {
      let result: FootprintResult | undefined;
      try {
        result = await source.forEvent(e);
      } catch (err) {
        console.error(`footprint fetch failed for ${footprintKey(e)}: ${String(err)}`);
      }
      if (!result) return { ...e };
      if (result.geometry) {
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
      return { ...e, footprint: result.summary };
    }),
  );
  return { model: { ...model, surfaced }, geometryById };
}
