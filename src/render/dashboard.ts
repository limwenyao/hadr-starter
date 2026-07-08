import type { SitrepModel, SurfacedEvent, Tier } from "../types.js";
import { formatUtc } from "../time.js";

/**
 * Priority view of the daily brief (ADR 0005): ranked tier sections,
 * colour-coded, detail card per surfaced event. Static HTML, no JS needed
 * yet — the interactive map/spatial view is a later slice (ADR 0010).
 * All feed-derived text is escaped: feeds are untrusted input.
 */

const TIERS: readonly Tier[] = ["CRITICAL", "HIGH", "MODERATE"];

const TIER_META: Record<Tier, { emoji: string; colour: string }> = {
  CRITICAL: { emoji: "\u{1F534}", colour: "#c0392b" },
  HIGH: { emoji: "\u{1F7E0}", colour: "#e67e22" },
  MODERATE: { emoji: "\u{1F7E1}", colour: "#b7950b" },
};

function esc(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function metricBadges(event: SurfacedEvent): string {
  const badges: string[] = [];
  // Show the hazard type for non-earthquake hazards (GDACS is multi-hazard).
  if (event.hazardType && event.hazardType !== "EQ") badges.push(event.hazardType);
  if (event.metrics.mag !== undefined) badges.push(`M ${event.metrics.mag}`);
  if (event.metrics.pagerAlert) badges.push(`PAGER ${event.metrics.pagerAlert}`);
  if (event.metrics.alertLevel) badges.push(`alert ${event.metrics.alertLevel}`);
  if (event.metrics.sig !== undefined) badges.push(`sig ${event.metrics.sig}`);
  return badges.map((b) => `<span class="metric">${esc(b)}</span>`).join(" ");
}

/** Duplicate-flag note (ADR 0007): labelled, both events still shown. */
function duplicateNote(event: SurfacedEvent): string {
  if (!event.duplicateOf) return "";
  const { feed, title } = event.duplicateOf;
  return `<p class="dup">⚠ Likely the same event as ${esc(feed)} — ${esc(title)}</p>`;
}

function detailCard(event: SurfacedEvent): string {
  // Feeds are untrusted: only link http(s) URLs — entity-escaping alone
  // does not stop javascript: (and other scheme) injection into href.
  const link =
    event.sourceUrl && /^https?:\/\//i.test(event.sourceUrl)
      ? `<a href="${esc(event.sourceUrl)}" rel="noopener">source</a>`
      : "";
  return `
    <article class="card tier-${event.tier}">
      <header>
        <span class="feed">${esc(event.feed)}</span>
        <span class="tier">${esc(event.tier)}</span>
        <strong>${esc(event.title)}</strong>
      </header>
      <p class="meta">
        ${esc(event.locationName)} ·
        ${esc(formatUtc(event.time))} ·
        ${metricBadges(event)} ${link}
      </p>
      ${duplicateNote(event)}
      <p class="assessment">${esc(event.assessment ?? "")}</p>
    </article>`;
}

function tierSection(tier: Tier, events: SurfacedEvent[]): string {
  if (events.length === 0) return "";
  const { emoji, colour } = TIER_META[tier];
  return `
  <section class="tier-section" style="border-left: 6px solid ${colour}">
    <h2>${emoji} ${tier} (${events.length})</h2>
    ${events.map(detailCard).join("\n")}
  </section>`;
}

function degradationNotices(model: SitrepModel): string {
  if (model.degradation.length === 0) return "";
  const items = model.degradation
    .map(
      (d) =>
        `<li><strong>${esc(d.feed)} feed unavailable</strong> this run — ${esc(d.reason)}. Events from this feed are missing below.</li>`,
    )
    .join("\n");
  return `<aside class="degradation"><ul>${items}</ul></aside>`;
}

export function renderDashboard(model: SitrepModel): string {
  const activeTiers = new Set(model.surfaced.map((e) => e.tier));

  // Emit in severity order (the TIERS constant), not surfaced order — the CSS
  // reads top-down regardless of how events happen to be sorted.
  const tierCss = TIERS.filter((tier) => activeTiers.has(tier))
    .map(
      (tier) =>
        `.tier-${tier} .tier { background: ${TIER_META[tier].colour}; color: #fff; }`,
    )
    .join("\n  ");

  const body =
    model.surfaced.length === 0
      ? `<p class="quiet">No surfaced events this run — a quiet morning.</p>`
      : TIERS.map((tier) =>
          tierSection(tier, model.surfaced.filter((e) => e.tier === tier)),
        ).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HADR Monitor — Situation Report</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; color: #1c2833; }
  h1 { margin-bottom: 0.25rem; }
  .generated { color: #566573; margin-top: 0; }
  .degradation { background: #fdecea; border: 1px solid #c0392b; border-radius: 6px; padding: 0.5rem 1rem; margin: 1rem 0; }
  .tier-section { margin: 1.5rem 0; padding: 0.25rem 1rem; background: #fbfcfc; border-radius: 4px; }
  .card { border-bottom: 1px solid #e5e8e8; padding: 0.75rem 0; }
  .card:last-child { border-bottom: none; }
  .feed, .tier { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.05em; padding: 0.1rem 0.4rem; border-radius: 3px; background: #eaecee; margin-right: 0.5rem; }
  ${tierCss}
  .meta { color: #566573; font-size: 0.9rem; }
  .metric { background: #eaecee; border-radius: 3px; padding: 0 0.3rem; }
  .dup { margin: 0.25rem 0 0; color: #7d6608; font-size: 0.85rem; font-style: italic; }
  .assessment { margin: 0.25rem 0 0; }
  .quiet { color: #566573; font-style: italic; }
</style>
</head>
<body>
<h1>HADR Monitor — Situation Report</h1>
<p class="generated">Generated ${esc(formatUtc(model.generatedAt))} · feeds: USGS, GDACS (ReliefWeb lands in a later slice)</p>
${degradationNotices(model)}
${body}
</body>
</html>`;
}
