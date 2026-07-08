import { writeFileSync } from "node:fs";
import { fetchUsgs } from "./feeds/usgs.js";
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
  const usgs = await fetchUsgs();
  const model = buildSitrep([usgs], null, new Date());

  console.log(
    `surfaced ${model.surfaced.length} event(s)` +
      (model.degradation.length
        ? `; feeds unavailable: ${model.degradation.map((d) => d.feed).join(", ")}`
        : ""),
  );

  const assessed = await fillAssessments(model, claudeCliWriter);
  writeFileSync("dashboard.html", renderDashboard(assessed), "utf8");
  console.log("wrote dashboard.html");
} catch (err) {
  console.error(`run failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
}
