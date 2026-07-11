/** Domain shapes — vocabulary per CONTEXT.md, seam contract per docs/PRD.md. */

import type { FeatureCollection } from "geojson";

export type Tier = "CRITICAL" | "HIGH" | "MODERATE";

export type FeedName = "USGS" | "GDACS" | "ReliefWeb";

export type PagerAlert = "green" | "yellow" | "orange" | "red";

/** GDACS colour-coded alert level (GDACS only — never conflate with PagerAlert). */
export type GdacsAlertLevel = "green" | "orange" | "red";

/** One disaster occurrence as reported by one feed, normalised. */
export interface Event {
  feed: FeedName;
  /** The feed's own canonical id (USGS `id`) — stable identity across runs. */
  feedEventId: string;
  hazardType: string; // "EQ" for USGS
  title: string;
  locationName: string;
  /** Absent for feeds without coordinates (ReliefWeb, later slice). */
  coordinates?: { lon: number; lat: number; depthKm?: number };
  /** Event time, epoch milliseconds UTC. */
  time: number;
  /**
   * Upstream last-modified time, epoch ms UTC (bitemporal source clock, ADR 0011).
   * `updateProvenance` records whether this came from the source or was inferred
   * from `time` when the feed exposes no usable update stamp (never overstate).
   */
  sourceUpdatedAt?: number;
  updateProvenance?: "source" | "inferred";
  metrics: {
    mag?: number;
    sig?: number;
    /** USGS PAGER impact alert. */
    pagerAlert?: PagerAlert;
    /** GDACS colour-coded alert level. */
    alertLevel?: GdacsAlertLevel;
  };
  sourceUrl?: string;
  /**
   * Feed-supplied URL from which this event's impact footprint can be fetched
   * (USGS detail GeoJSON; GDACS getgeometry). Absent when the feed exposes none
   * or the event has no coordinates. Consumed only by the footprint enrichment.
   */
  footprintRef?: string;
}

/** An event that passed the noise floor and carries its priority tier. */
export interface SurfacedEvent extends Event {
  tier: Tier;
  /** LLM-written narrative; filled outside the pure core (ADR 0003). */
  assessment?: string;
  /**
   * Set when this event is a likely duplicate of an earlier, higher-priority
   * surfaced event from another feed (ADR 0007). Flagged, never merged: both
   * events remain in `surfaced`.
   */
  duplicateOf?: { feed: FeedName; feedEventId: string; title: string };
  /**
   * Change vs the prior snapshot (ADR 0009): newly surfaced, or materially
   * revised (magnitude/tier/alert level) with a deterministic note. Absent when
   * unchanged or when no prior snapshot existed.
   */
  change?: { kind: "new" | "revised"; note?: string };
  /**
   * Compact provenance summary of this event's impact area (impact-zones slice).
   * Part of the snapshot (audit) and the panel text. The raw geometry is NOT
   * stored here — it travels separately to the renderer. Absent when no zone.
   */
  footprint?: FootprintSummary;
}

/** Raw result of one feed fetch — failures are data, not exceptions (ADR 0008). */
export type FeedResult =
  | { feed: FeedName; status: "ok"; rawPayload: unknown }
  | { feed: FeedName; status: "unavailable"; error: string };

/** The render model buildSitrep produces — the PRD's SitrepModel. */
export interface SitrepModel {
  generatedAt: number; // epoch ms, from injected `now`
  /** Sorted most-severe-first. */
  surfaced: SurfacedEvent[];
  degradation: { feed: FeedName; reason: string }[];
  /**
   * Previously-reported events that vanished from their feed while still inside
   * its visibility window (ADR 0009) — possibly withdrawn. Panel notes only.
   */
  withdrawn: { feed: FeedName; feedEventId: string; note: string }[];
  /**
   * Deterministic change verdict vs the prior snapshot; null when no prior
   * snapshot existed (first run). The scheduled quiet-gate's input (ADR 0010).
   */
  changeSummary: { new: number; revised: number; withdrawn: number } | null;
}

/** How much to trust an impact area — drives its visual + caption. */
export type FootprintProvenance = "shakemap" | "gdacs" | "estimated";

/** Compact, snapshot-safe description of one event's impact area. */
export interface FootprintSummary {
  provenance: FootprintProvenance;
  /** e.g. "Modeled shaking (USGS ShakeMap)". */
  label: string;
  /** True for the magnitude/depth estimate ring — drives dashed style + caption. */
  isEstimate: boolean;
  /** ShakeMap only: peak modeled intensity across contours. */
  maxMmi?: number;
  /** Estimate ring radius, or a modeled polygon's rough bbox radius. */
  radiusKm?: number;
}

/**
 * A summariser's output: the compact summary plus the normalized geometry
 * (FeatureCollection whose every feature.properties matches the normalized
 * shape in the plan's Global Constraints, minus eventId which fillFootprints
 * stamps). geometry is absent when there is nothing drawable.
 */
export interface FootprintResult {
  summary: FootprintSummary;
  geometry?: FeatureCollection;
}

/**
 * Per-feed fetch health derived from ingest_runs (Data Sources tab). run_at is
 * shared by all feeds in a run, so "last successful fetch" means the last run in
 * which the feed was in feeds_ok — not a per-feed fetch instant (see deviation).
 */
export interface FetchStatus {
  /** Epoch ms of the newest ingest run, or null when no runs recorded. */
  latestRunAt: number | null;
  /** feeds_ok of that newest run. */
  latestFeedsOk: string[];
  /** feed -> epoch ms of its most recent successful (feeds_ok) run. */
  lastOkByFeed: Record<string, number>;
}
