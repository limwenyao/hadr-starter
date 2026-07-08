import type { Event, PagerAlert } from "../types.js";

/**
 * USGS real-time earthquake feed (feeds/usgs.md). GeoJSON FeatureCollection.
 * We store the canonical `id` (not the `ids` list) as feedEventId — stable
 * per-event identity across runs (ADR 0009).
 */

const PAGER_ALERTS: readonly PagerAlert[] = ["green", "yellow", "orange", "red"];

interface UsgsFeature {
  id?: unknown;
  properties?: {
    mag?: unknown;
    place?: unknown;
    time?: unknown;
    alert?: unknown;
    sig?: unknown;
    title?: unknown;
    url?: unknown;
  } | null;
  geometry?: { coordinates?: unknown } | null;
}

/** Pure raw-payload → Event[] normaliser. Skips malformed features; never throws. */
export function parseUsgs(rawPayload: unknown): Event[] {
  const features = (rawPayload as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];

  const events: Event[] = [];
  for (const raw of features) {
    const event = parseFeature(raw as UsgsFeature);
    if (event) events.push(event);
  }
  return events;
}

function parseFeature(feature: UsgsFeature | null): Event | undefined {
  const props = feature?.properties;
  if (!feature || typeof feature.id !== "string" || !props) return undefined;
  if (typeof props.time !== "number") return undefined;

  const place = typeof props.place === "string" ? props.place : "location unknown";
  const coords = Array.isArray(feature.geometry?.coordinates)
    ? (feature.geometry!.coordinates as unknown[])
    : undefined;

  return {
    feed: "USGS",
    feedEventId: feature.id,
    hazardType: "EQ",
    title: typeof props.title === "string" ? props.title : place,
    locationName: place,
    coordinates:
      coords && typeof coords[0] === "number" && typeof coords[1] === "number"
        ? {
            lon: coords[0],
            lat: coords[1],
            depthKm: typeof coords[2] === "number" ? coords[2] : undefined,
          }
        : undefined,
    time: props.time,
    metrics: {
      mag: typeof props.mag === "number" ? props.mag : undefined,
      sig: typeof props.sig === "number" ? props.sig : undefined,
      pagerAlert: PAGER_ALERTS.includes(props.alert as PagerAlert)
        ? (props.alert as PagerAlert)
        : undefined,
    },
    sourceUrl: typeof props.url === "string" ? props.url : undefined,
  };
}
