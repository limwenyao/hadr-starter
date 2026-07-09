/** Domain shapes — vocabulary per CONTEXT.md, seam contract per docs/PRD.md. */

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
  metrics: {
    mag?: number;
    sig?: number;
    /** USGS PAGER impact alert. */
    pagerAlert?: PagerAlert;
    /** GDACS colour-coded alert level. */
    alertLevel?: GdacsAlertLevel;
  };
  sourceUrl?: string;
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
