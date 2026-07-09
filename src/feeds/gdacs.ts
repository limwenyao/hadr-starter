import type { Event, FeedResult, GdacsAlertLevel } from "../types.js";
import { isValidEventTime } from "../time.js";

/**
 * GDACS multi-hazard feed (feeds/gdacs.md). GeoJSON FeatureCollection. We store
 * the event-level `eventid` as feedEventId — stable identity across runs. Change
 * detection (ADR 0009) keys on (feed, feedEventId); the revision-level `episodeid`
 * is parsed but not used for identity (episode-granular tracking is out of scope).
 * GDACS carries an *alert level* (colour), distinct from USGS's PAGER alert.
 */

const ALERT_LEVELS: Record<string, GdacsAlertLevel> = {
  green: "green",
  orange: "orange",
  red: "red",
};

interface GdacsFeature {
  properties?: {
    eventtype?: unknown;
    eventid?: unknown;
    name?: unknown;
    alertlevel?: unknown;
    country?: unknown;
    fromdate?: unknown;
    url?: { report?: unknown } | null;
  } | null;
  geometry?: { coordinates?: unknown } | null;
}

/**
 * Parse a GDACS `fromdate` as UTC epoch ms. GDACS timestamps carry no offset
 * (e.g. "2026-07-06T11:29:36"); JS would read an offset-less date-time as *local*
 * time, misplacing every event by the host timezone — so append `Z` when absent.
 * Returns undefined for anything unparseable or out of Date range (never throws).
 */
function parseGdacsDate(raw: unknown): number | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  const ms = Date.parse(hasZone ? raw : `${raw}Z`);
  return Number.isFinite(ms) && isValidEventTime(ms) ? ms : undefined;
}

/** Pure raw-payload → Event[] normaliser. Skips malformed features; never throws. */
export function parseGdacs(rawPayload: unknown): Event[] {
  const features = (rawPayload as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];

  const events: Event[] = [];
  for (const raw of features) {
    const event = parseFeature(raw as GdacsFeature);
    if (event) events.push(event);
  }
  return events;
}

function parseFeature(feature: GdacsFeature | null): Event | undefined {
  const props = feature?.properties;
  if (!feature || !props) return undefined;

  // A usable id and timestamp are mandatory.
  const eventId = props.eventid;
  if (typeof eventId !== "number" && typeof eventId !== "string") return undefined;
  const time = parseGdacsDate(props.fromdate);
  if (time === undefined) return undefined;

  const country = typeof props.country === "string" && props.country.length > 0
    ? props.country
    : "location unknown";
  const name = typeof props.name === "string" ? props.name : country;
  const coords = Array.isArray(feature.geometry?.coordinates)
    ? (feature.geometry!.coordinates as unknown[])
    : undefined;
  const alertKey =
    typeof props.alertlevel === "string" ? props.alertlevel.toLowerCase() : "";
  const report = props.url?.report;

  return {
    feed: "GDACS",
    feedEventId: String(eventId),
    hazardType: typeof props.eventtype === "string" ? props.eventtype : "unknown",
    title: name,
    locationName: country,
    coordinates:
      coords && typeof coords[0] === "number" && typeof coords[1] === "number"
        ? { lon: coords[0], lat: coords[1] }
        : undefined,
    time,
    metrics: {
      alertLevel: ALERT_LEVELS[alertKey],
    },
    sourceUrl: typeof report === "string" ? report : undefined,
  };
}

const GDACS_EVENTS_URL =
  "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP";

/**
 * Thin HTTP adapter — the only networked GDACS code. Never throws: any
 * failure becomes a FeedResult the core turns into a degradation notice
 * (ADR 0008). Not unit-tested (no network in tests); exercised by the run.
 */
export async function fetchGdacs(): Promise<FeedResult> {
  try {
    const res = await fetch(GDACS_EVENTS_URL, {
      headers: { "user-agent": "hadr-monitor (workshop build)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return { feed: "GDACS", status: "unavailable", error: `HTTP ${res.status}` };
    }
    return { feed: "GDACS", status: "ok", rawPayload: await res.json() };
  } catch (err) {
    return { feed: "GDACS", status: "unavailable", error: String(err) };
  }
}
