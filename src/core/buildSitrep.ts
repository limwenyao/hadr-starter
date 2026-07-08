import type {
  Event,
  FeedResult,
  SitrepModel,
  SurfacedEvent,
  Tier,
} from "../types.js";
import { parseUsgs } from "../feeds/usgs.js";
import { passesNoiseFloor, tierFor } from "./triage.js";

const TIER_ORDER: Record<Tier, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2 };

/**
 * THE seam (docs/PRD.md → Implementation Decisions). Pure and deterministic:
 * no network, no LLM, no ambient clock. Feed failures arrive as data and leave
 * as degradation notices (ADR 0008). priorSnapshot is part of the contract but
 * unused this slice — change detection lands with snapshots (ADR 0010).
 */
export function buildSitrep(
  feedResults: FeedResult[],
  priorSnapshot: SitrepModel | null,
  now: Date,
): SitrepModel {
  void priorSnapshot; // reserved for change detection (later slice)

  const degradation = feedResults
    .filter((r) => r.status === "unavailable")
    .map((r) => ({ feed: r.feed, reason: r.error }));

  const events: Event[] = feedResults
    .filter((r) => r.status === "ok")
    .flatMap((r) => (r.feed === "USGS" ? parseUsgs(r.rawPayload) : []));

  const surfaced: SurfacedEvent[] = events
    .filter(passesNoiseFloor)
    .map((e) => ({ ...e, tier: tierFor(e) }))
    .sort(
      (a, b) =>
        TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
        (b.metrics.mag ?? 0) - (a.metrics.mag ?? 0),
    );

  return { generatedAt: now.getTime(), surfaced, degradation };
}
