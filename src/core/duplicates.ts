import type { SurfacedEvent } from "../types.js";
import { DUP_DISTANCE_KM, DUP_TIME_WINDOW_MS } from "../thresholds.js";

/**
 * Duplicate flagging (ADR 0007). The same physical disaster can arrive from more
 * than one feed under different ids (GDACS earthquakes often come from NEIC, the
 * same agency behind USGS). We detect *likely* duplicates heuristically and flag
 * them — we never merge or drop (CLAUDE.md #5). True correlation is a later spike.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in km between two lon/lat points. */
export function haversineKm(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * A pair is a likely duplicate when it comes from *different* feeds (cross-feed
 * only — two nearby events in one feed are distinct), shares a hazard type, and
 * is close in both time and space. Events without coordinates never match.
 */
function isLikelyDuplicate(primary: SurfacedEvent, candidate: SurfacedEvent): boolean {
  if (primary.feed === candidate.feed) return false;
  if (primary.hazardType !== candidate.hazardType) return false;
  if (!primary.coordinates || !candidate.coordinates) return false;
  if (Math.abs(primary.time - candidate.time) > DUP_TIME_WINDOW_MS) return false;
  return haversineKm(primary.coordinates, candidate.coordinates) <= DUP_DISTANCE_KM;
}

/**
 * Returns a new array where each event that is a likely duplicate of an earlier,
 * higher-priority event carries a `duplicateOf` note pointing at that primary.
 * Input `surfaced` is expected already sorted most-severe-first, so the first
 * member of any duplicate cluster is the primary. Pure; does not mutate input.
 */
export function flagDuplicates(surfaced: SurfacedEvent[]): SurfacedEvent[] {
  return surfaced.map((event, index) => {
    for (let i = 0; i < index; i++) {
      const primary = surfaced[i];
      // Skip primaries that are themselves flagged — attribute to the cluster head.
      if (primary.duplicateOf) continue;
      if (isLikelyDuplicate(primary, event)) {
        return {
          ...event,
          duplicateOf: {
            feed: primary.feed,
            feedEventId: primary.feedEventId,
            title: primary.title,
          },
        };
      }
    }
    return event;
  });
}
