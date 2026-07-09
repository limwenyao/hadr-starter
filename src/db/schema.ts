import {
  pgTable, bigserial, text, timestamp, doublePrecision, jsonb,
  boolean, integer, unique, index,
} from "drizzle-orm/pg-core";

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
    metrics: jsonb("metrics").notNull(),
    hazardType: text("hazard_type").notNull(),
    assessment: text("assessment"),
    footprint: jsonb("footprint"),
    sourceUrl: text("source_url"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniqVersion: unique("uniq_source_version").on(t.feed, t.feedEventId, t.sourceUpdatedAt),
    byEvent: index("idx_by_event").on(t.feed, t.feedEventId, t.sourceUpdatedAt.desc()),
    byEventTime: index("idx_event_time").on(t.eventTime),
    bySourceUpdated: index("idx_source_updated").on(t.sourceUpdatedAt),
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
