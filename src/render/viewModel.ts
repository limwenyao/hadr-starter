import type { FeedName, FootprintSummary, SitrepModel, SurfacedEvent, Tier } from "../types.js";
import { formatUtc } from "../time.js";
import { STALE_AFTER_MS } from "../thresholds.js";

/**
 * View-model for the map dashboard (ADR 0005). ALL render logic lives here,
 * server-side and unit-tested — the client script that consumes this JSON is
 * deliberately dumb (tests never run a browser, so nothing decision-shaped may
 * hide there). Feed text is NOT escaped here: it travels as JSON and the client
 * renders it via textContent only.
 */

const TIERS: readonly Tier[] = ["CRITICAL", "HIGH", "MODERATE"];

export interface EventCardVM {
  id: string;
  /** Composite identity `${feed} ${feedEventId}` — used to look up embedded geometry. */
  key: string;
  feed: FeedName;
  tier: Tier;
  title: string;
  location: string;
  timeUtc: string;
  /** Precomputed metric badge strings, e.g. "M 7.2", "PAGER red". */
  badges: string[];
  /** ADR 0007 flag note, or null when unflagged. */
  duplicateNote: string | null;
  /** New since the prior snapshot (ADR 0009). */
  isNew: boolean;
  /** Materially revised since the prior snapshot (ADR 0009). */
  isUpdated: boolean;
  /** Deterministic revision note, or null when unchanged (ADR 0009). */
  changeNote: string | null;
  assessment: string;
  /** Sanitized server-side: http(s) only, anything else becomes null. */
  sourceUrl: string | null;
  /** null for feeds without coordinates (ReliefWeb) — list-only, never pinned. */
  coordinates: { lon: number; lat: number } | null;
  /** Impact-area summary (impact-zones slice), or null when the event has no zone. */
  footprint: FootprintSummary | null;
  /** Upstream last-updated time, formatted UTC (bitemporal source clock). */
  sourceUpdatedUtc: string;
  /** Human relative age of the source update, e.g. "~2h ago". */
  sourceUpdatedAgeLabel: string;
  /** Source update older than STALE_AFTER_MS — soft hint only. */
  stalenessHint: boolean;
  /** Whether the update time came from the source or was inferred from event time. */
  updateProvenance: "source" | "inferred";
}

export interface DashboardVM {
  generatedUtc: string;
  feedsLine: string;
  totalCount: number;
  /** Severity order, empty tiers omitted. */
  tiers: { tier: Tier; count: number; events: EventCardVM[] }[];
  degradation: { feed: FeedName; reason: string }[];
  /** Possibly-withdrawn notes (ADR 0009) — panel text, never pins. */
  withdrawn: string[];
  /** One-line change summary vs the prior snapshot, or null on first runs. */
  changesLine: string | null;
}

function badgesFor(event: SurfacedEvent): string[] {
  const badges: string[] = [];
  if (event.hazardType && event.hazardType !== "EQ") badges.push(event.hazardType);
  if (event.metrics.mag !== undefined) badges.push(`M ${event.metrics.mag}`);
  if (event.metrics.pagerAlert) badges.push(`PAGER ${event.metrics.pagerAlert}`);
  if (event.metrics.alertLevel) badges.push(`alert ${event.metrics.alertLevel}`);
  if (event.metrics.sig !== undefined) badges.push(`sig ${event.metrics.sig}`);
  return badges;
}

function ageLabel(ms: number): string {
  if (ms < 0) ms = 0;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `~${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `~${hrs}h ago`;
  return `~${Math.round(hrs / 24)}d ago`;
}

function cardFor(event: SurfacedEvent, generatedAt: number): EventCardVM {
  return {
    id: event.feedEventId,
    key: `${event.feed} ${event.feedEventId}`,
    feed: event.feed,
    tier: event.tier,
    title: event.title,
    location: event.locationName,
    timeUtc: formatUtc(event.time),
    badges: badgesFor(event),
    duplicateNote: event.duplicateOf
      ? `Likely the same event as ${event.duplicateOf.feed} — ${event.duplicateOf.title}`
      : null,
    isNew: event.change?.kind === "new",
    isUpdated: event.change?.kind === "revised",
    changeNote: event.change?.note ?? null,
    assessment: event.assessment ?? "",
    // Entity-escaping alone does not stop javascript:-scheme injection into href.
    sourceUrl:
      event.sourceUrl && /^https?:\/\//i.test(event.sourceUrl)
        ? event.sourceUrl
        : null,
    coordinates: event.coordinates
      ? { lon: event.coordinates.lon, lat: event.coordinates.lat }
      : null,
    footprint: event.footprint ?? null,
    sourceUpdatedUtc: formatUtc(event.sourceUpdatedAt ?? event.time),
    sourceUpdatedAgeLabel: ageLabel(generatedAt - (event.sourceUpdatedAt ?? event.time)),
    stalenessHint: generatedAt - (event.sourceUpdatedAt ?? event.time) > STALE_AFTER_MS,
    updateProvenance: event.updateProvenance ?? "inferred",
  };
}

export function buildViewModel(model: SitrepModel): DashboardVM {
  const tiers = TIERS.map((tier) => {
    const events = model.surfaced
      .filter((e) => e.tier === tier)
      .map((e) => cardFor(e, model.generatedAt));
    return { tier, count: events.length, events };
  }).filter((group) => group.count > 0);

  const s = model.changeSummary;
  return {
    generatedUtc: formatUtc(model.generatedAt),
    feedsLine: "USGS, GDACS, ReliefWeb",
    totalCount: model.surfaced.length,
    tiers,
    degradation: model.degradation.map((d) => ({ feed: d.feed, reason: d.reason })),
    withdrawn: model.withdrawn.map((w) => w.note),
    changesLine: s
      ? `since yesterday: ${s.new} new · ${s.revised} revised · ${s.withdrawn} possibly withdrawn`
      : null,
  };
}
