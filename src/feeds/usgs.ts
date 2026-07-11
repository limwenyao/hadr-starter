import type { Event, FeedResult, PagerAlert } from "../types.js";
import { isValidEventTime } from "../time.js";

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
    updated?: unknown;
    alert?: unknown;
    sig?: unknown;
    title?: unknown;
    url?: unknown;
    detail?: unknown;
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
  // A usable timestamp is mandatory: reject NaN/Infinity and out-of-Date-range
  // values so a malformed time can never crash a downstream formatter.
  if (typeof props.time !== "number" || !isValidEventTime(props.time)) return undefined;

  const place = typeof props.place === "string" ? props.place : "location unknown";
  const coords = Array.isArray(feature.geometry?.coordinates)
    ? (feature.geometry!.coordinates as unknown[])
    : undefined;

  const hasUpdated = typeof props.updated === "number" && isValidEventTime(props.updated);
  const sourceUpdatedAt = hasUpdated ? (props.updated as number) : props.time;
  const updateProvenance = hasUpdated ? "source" as const : "inferred" as const;

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
    sourceUpdatedAt,
    updateProvenance,
    metrics: {
      mag: typeof props.mag === "number" ? props.mag : undefined,
      sig: typeof props.sig === "number" ? props.sig : undefined,
      pagerAlert: PAGER_ALERTS.includes(props.alert as PagerAlert)
        ? (props.alert as PagerAlert)
        : undefined,
    },
    sourceUrl: typeof props.url === "string" ? props.url : undefined,
    footprintRef: typeof props.detail === "string" ? props.detail : undefined,
  };
}

export const USGS_ALL_DAY_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

/**
 * Thin HTTP adapter — the only networked USGS code. Never throws: any
 * failure becomes a FeedResult the core turns into a degradation notice
 * (ADR 0008). Not unit-tested (no network in tests); exercised by the run.
 */
export async function fetchUsgs(): Promise<FeedResult> {
  try {
    const res = await fetch(USGS_ALL_DAY_URL, {
      headers: { "user-agent": "hadr-monitor (workshop build)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { feed: "USGS", status: "unavailable", error: `HTTP ${res.status}` };
    }
    return { feed: "USGS", status: "ok", rawPayload: await res.json() };
  } catch (err) {
    return { feed: "USGS", status: "unavailable", error: String(err) };
  }
}
