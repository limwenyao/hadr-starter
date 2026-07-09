import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema.js";
import type { EventVersionRow } from "./schema.js";
import { rowToSurfacedEvent } from "./mapping.js";
import type { SurfacedEvent } from "../types.js";

type Db = PostgresJsDatabase<typeof schema>;

/** Newest version per (feed, feed_event_id) — the current surfaced set. */
export async function latestSurfacedEvents(db: Db): Promise<SurfacedEvent[]> {
  const rows = await db.execute<EventVersionRow>(sql`
    SELECT DISTINCT ON (feed, feed_event_id) *
    FROM event_versions
    ORDER BY feed, feed_event_id, source_updated_at DESC
  `);
  // postgres-js returns snake_case; map explicitly to the camelCase row shape.
  return (rows as unknown as Record<string, unknown>[]).map((r) => rowToSurfacedEvent({
    feed: r.feed as string, feedEventId: r.feed_event_id as string,
    sourceUpdatedAt: r.source_updated_at as Date, updateProvenance: r.update_provenance as string,
    eventTime: r.event_time as Date, tier: r.tier as string, title: r.title as string,
    locationName: r.location_name as string, lon: r.lon as number | null, lat: r.lat as number | null,
    depthKm: r.depth_km as number | null,
    metrics: r.metrics, hazardType: r.hazard_type as string,
    assessment: (r.assessment ?? null) as string | null, footprint: r.footprint ?? null,
    sourceUrl: (r.source_url ?? null) as string | null, ingestedAt: r.ingested_at as Date,
  } as unknown as EventVersionRow));
}
