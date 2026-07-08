/** Domain shapes — vocabulary per CONTEXT.md, seam contract per docs/PRD.md. */

export type Tier = "CRITICAL" | "HIGH" | "MODERATE";

export type FeedName = "USGS" | "GDACS" | "ReliefWeb";

export type PagerAlert = "green" | "yellow" | "orange" | "red";

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
    pagerAlert?: PagerAlert;
  };
  sourceUrl?: string;
}

/** An event that passed the noise floor and carries its priority tier. */
export interface SurfacedEvent extends Event {
  tier: Tier;
  /** LLM-written narrative; filled outside the pure core (ADR 0003). */
  assessment?: string;
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
}
