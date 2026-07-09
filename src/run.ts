import { writeFileSync } from "node:fs";
import { fetchUsgs } from "./feeds/usgs.js";
import { fetchGdacs } from "./feeds/gdacs.js";
import { reliefWebSource } from "./feeds/reliefweb.js";
import { readPriorSnapshot, writeSnapshot } from "./snapshots.js";
import { buildSitrep } from "./core/buildSitrep.js";
import { claudeCliWriter, fillAssessments } from "./assessment/writer.js";
import { shouldAssess, carryForwardAssessments } from "./assessment/gate.js";
import { renderDashboard } from "./render/dashboard.js";
import { fillFootprints } from "./footprints/fill.js";
import { httpFootprintSource } from "./footprints/source.js";

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

  // Deterministic quiet-gate (ADR 0010): call the model only when something
  // changed (or on a forced/first run). On a quiet day, reuse prior prose —
  // the model never decides whether the run wakes up (CLAUDE.md #2).
  const force = process.env.FORCE === "true";
  const assess = shouldAssess(model.changeSummary, force);
  console.log(
    assess
      ? "writing assessments (change detected, first run, or forced)"
      : "quiet run — carrying forward prior assessments (no model call)",
  );
  // Footprints are deterministic I/O, not the LLM — fetched every run,
  // independent of the quiet-gate (CLAUDE.md #2). Failures degrade to no zone.
  const { model: withFootprints, geometryById } = await fillFootprints(model, httpFootprintSource);

  const assessed = assess
    ? await fillAssessments(withFootprints, claudeCliWriter)
    : carryForwardAssessments(withFootprints, prior);
  writeFileSync("dashboard.html", renderDashboard(assessed, geometryById), "utf8");
  // Persist the assessed model: the snapshot records what the brief actually
  // said (audit trail — ADR 0006). Geometry is not persisted (summary-only).
  writeSnapshot("data", now, assessed);
  console.log("wrote dashboard.html and data snapshot");
} catch (err) {
  console.error(`run failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
}
