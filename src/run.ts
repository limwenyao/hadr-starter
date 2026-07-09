import { writeFileSync } from "node:fs";
import { fetchUsgs } from "./feeds/usgs.js";
import { fetchGdacs } from "./feeds/gdacs.js";
import { reliefWebSource } from "./feeds/reliefweb.js";
import { readPriorSnapshot, writeSnapshot } from "./snapshots.js";
import { buildSitrep } from "./core/buildSitrep.js";
import { claudeCliWriter, fillAssessments } from "./assessment/writer.js";
import { renderDashboard } from "./render/dashboard.js";

/**
 * One run of the agent (v1 slice): pull → filter → assess → render.
 * Snapshots and scheduling land in later slices (ADR 0010).
 *
 * Top-level guard: the core and adapters are built not to throw, but an
 * unforeseen error here must exit non-zero (so the scheduler notices) rather
 * than crash unhandled — never fail silently (CLAUDE.md #4).
 */
try {
  // Feeds are independent — poll them concurrently; each returns a FeedResult
  // (never throws), so one feed being down never sinks the others (ADR 0008).
  const feedResults = await Promise.all([
    fetchUsgs(),
    fetchGdacs(),
    reliefWebSource.fetch(),
  ]);

  const now = new Date();
  const prior = readPriorSnapshot("data", now);
  const model = buildSitrep(feedResults, prior, now);

  const changes = model.changeSummary
    ? `; changes vs prior: ${model.changeSummary.new} new, ${model.changeSummary.revised} revised, ${model.changeSummary.withdrawn} possibly withdrawn`
    : "; no prior snapshot (first run — no change notes)";
  console.log(
    `surfaced ${model.surfaced.length} event(s)` +
      (model.degradation.length
        ? `; feeds unavailable: ${model.degradation.map((d) => d.feed).join(", ")}`
        : "") +
      changes,
  );

  const assessed = await fillAssessments(model, claudeCliWriter);
  writeFileSync("dashboard.html", renderDashboard(assessed), "utf8");
  // Persist the assessed model: the snapshot records what the brief actually
  // said (audit trail — ADR 0006). Committing is the caller's job.
  writeSnapshot("data", now, assessed);
  console.log("wrote dashboard.html and data snapshot");
} catch (err) {
  console.error(`run failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
}
