import {
  pgTable, bigserial, text, timestamp, doublePrecision, jsonb,
  boolean, integer, unique, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const eventVersions = pgTable(
  "event_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    feed: text("feed").notNull(),
    feedEventId: text("feed_event_id").notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    updateProvenance: text("update_provenance").notNull(), // 'source' | 'inferred'
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    tier: text("tier").notNull(),
    title: text("title").notNull(),
    locationName: text("location_name").notNull(),
    lon: doublePrecision("lon"),
    lat: doublePrecision("lat"),
    depthKm: doublePrecision("depth_km"),
    metrics: jsonb("metrics").notNull(),
    hazardType: text("hazard_type").notNull(),
    assessment: text("assessment"),
    footprint: jsonb("footprint"),
    footprintGeometry: jsonb("footprint_geometry"),
    sourceUrl: text("source_url"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniqVersion: unique("uniq_source_version").on(t.feed, t.feedEventId, t.sourceUpdatedAt),
    byEvent: index("idx_by_event").on(t.feed, t.feedEventId, t.sourceUpdatedAt.desc()),
    byEventTime: index("idx_event_time").on(t.eventTime),
    bySourceUpdated: index("idx_source_updated").on(t.sourceUpdatedAt),
    feedValid: check("event_versions_feed_valid", sql`${t.feed} in ('USGS','GDACS','ReliefWeb')`),
    tierValid: check("event_versions_tier_valid", sql`${t.tier} in ('CRITICAL','HIGH','MODERATE')`),
    provenanceValid: check("event_versions_provenance_valid", sql`${t.updateProvenance} in ('source','inferred')`),
  }),
);

export const ingestRuns = pgTable("ingest_runs", {
  runAt: timestamp("run_at", { withTimezone: true }).primaryKey(),
  feedsOk: text("feeds_ok").array().notNull(),
  feedsDown: jsonb("feeds_down").notNull(),   // [{ feed, reason }]
  surfacedCount: integer("surfaced_count").notNull(),
  dbWriteOk: boolean("db_write_ok").notNull(),
});

export type EventVersionRow = typeof eventVersions.$inferInsert;
export type IngestRunRow = typeof ingestRuns.$inferInsert;
