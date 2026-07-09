CREATE TABLE "event_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feed" text NOT NULL,
	"feed_event_id" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"update_provenance" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"tier" text NOT NULL,
	"title" text NOT NULL,
	"location_name" text NOT NULL,
	"lon" double precision,
	"lat" double precision,
	"metrics" jsonb NOT NULL,
	"hazard_type" text NOT NULL,
	"assessment" text,
	"footprint" jsonb,
	"source_url" text,
	"ingested_at" timestamp with time zone NOT NULL,
	CONSTRAINT "uniq_source_version" UNIQUE("feed","feed_event_id","source_updated_at")
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"run_at" timestamp with time zone PRIMARY KEY NOT NULL,
	"feeds_ok" text[] NOT NULL,
	"feeds_down" jsonb NOT NULL,
	"surfaced_count" integer NOT NULL,
	"db_write_ok" boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_by_event" ON "event_versions" USING btree ("feed","feed_event_id","source_updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_event_time" ON "event_versions" USING btree ("event_time");--> statement-breakpoint
CREATE INDEX "idx_source_updated" ON "event_versions" USING btree ("source_updated_at");