import type {
  Event,
  FeedName,
  FeedResult,
  SitrepModel,
  SurfacedEvent,
  Tier,
} from "../types.js";
import { parseUsgs } from "../feeds/usgs.js";
import { parseGdacs } from "../feeds/gdacs.js";
import { reliefWebSource } from "../feeds/reliefweb.js";
import { passesNoiseFloor, tierFor } from "./triage.js";
import { flagDuplicates } from "./duplicates.js";
import { detectChanges } from "./changes.js";

const TIER_ORDER: Record<Tier, number> = { CRITICAL: 0, HIGH: 1, MODERATE: 2 };

/** Per-feed pure parsers. Feeds not yet built parse to nothing (ADR 0010). */
const PARSERS: Partial<Record<FeedName, (raw: unknown) => Event[]>> = {
  USGS: parseUsgs,
  GDACS: parseGdacs,
  ReliefWeb: reliefWebSource.parse,
};

/**
 * THE seam (docs/PRD.md → Implementation Decisions). Pure and deterministic:
 * no network, no LLM, no ambient clock. Feed failures arrive as data and leave
 * as degradation notices (ADR 0008). The prior snapshot drives new/revised/
 * withdrawn change notes (ADR 0009).
 */
export function buildSitrep(
  feedResults: FeedResult[],
  priorSnapshot: SitrepModel | null,
  now: Date,
): SitrepModel {
  const degradation = feedResults
    .filter((r) => r.status === "unavailable")
    .map((r) => ({ feed: r.feed, reason: r.error }));

  const events: Event[] = feedResults
    .filter((r) => r.status === "ok")
    .flatMap((r) => PARSERS[r.feed]?.(r.rawPayload) ?? []);

  const sorted: SurfacedEvent[] = events
    .filter(passesNoiseFloor)
    .map((e) => ({ ...e, tier: tierFor(e) }))
    .sort(
      (a, b) =>
        TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
        (b.metrics.mag ?? 0) - (a.metrics.mag ?? 0),
    );

  // Flag likely cross-feed duplicates after ranking, so the first member of any
  // cluster (the most severe) is the primary (ADR 0007 — flag, never merge).
  const flagged = flagDuplicates(sorted);

  // Annotate vs the prior snapshot: new / revised notes on surfaced events,
  // possibly-withdrawn notes, and the deterministic change summary (ADR 0009).
  const { surfaced, withdrawn, changeSummary } = detectChanges(
    flagged,
    priorSnapshot,
    now,
  );

  return { generatedAt: now.getTime(), surfaced, degradation, withdrawn, changeSummary };
}
