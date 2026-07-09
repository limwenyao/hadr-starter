import type { SurfacedEvent, FeedName, Tier, FootprintSummary } from "../types.js";
import type { EventVersionRow } from "./schema.js";

/** Pure SurfacedEvent → row. Falls back to event time when no source update stamp. */
export function surfacedEventToRow(event: SurfacedEvent, ingestedAt: Date): EventVersionRow {
  const sourceUpdatedMs = event.sourceUpdatedAt ?? event.time;
  const provenance = event.updateProvenance ?? "inferred";
  return {
    feed: event.feed,
    feedEventId: event.feedEventId,
    sourceUpdatedAt: new Date(sourceUpdatedMs),
    updateProvenance: provenance,
    eventTime: new Date(event.time),
    tier: event.tier,
    title: event.title,
    locationName: event.locationName,
    lon: event.coordinates?.lon ?? null,
    lat: event.coordinates?.lat ?? null,
    depthKm: event.coordinates?.depthKm ?? null,
    metrics: event.metrics,
    hazardType: event.hazardType,
    assessment: event.assessment ?? null,
    footprint: event.footprint ?? null,
    sourceUrl: event.sourceUrl ?? null,
    ingestedAt,
  };
}

/** Row (post-select) → SurfacedEvent for the render path. */
export function rowToSurfacedEvent(row: EventVersionRow & { id?: number }): SurfacedEvent {
  const lon = row.lon;
  const lat = row.lat;
  const coordinates =
    lon != null && lat != null
      ? row.depthKm != null
        ? { lon, lat, depthKm: row.depthKm }
        : { lon, lat }
      : undefined;
  return {
    feed: row.feed as FeedName,
    feedEventId: row.feedEventId,
    hazardType: row.hazardType,
    title: row.title,
    locationName: row.locationName,
    coordinates,
    time: new Date(row.eventTime).getTime(),
    sourceUpdatedAt: new Date(row.sourceUpdatedAt).getTime(),
    updateProvenance: row.updateProvenance as "source" | "inferred",
    metrics: row.metrics as SurfacedEvent["metrics"],
    tier: row.tier as Tier,
    assessment: row.assessment ?? undefined,
    sourceUrl: row.sourceUrl ?? undefined,
    footprint: (row.footprint as FootprintSummary | null) ?? undefined,
  };
}
