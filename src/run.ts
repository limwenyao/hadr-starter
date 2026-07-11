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
import type { FeedResult, FetchStatus, SitrepModel } from "./types.js";

/**
 * One run of the agent (ADR 0010/0011). Two modes (Slice 2):
 *  - full    (default; daily 00:30 cron + manual): assess (gated vs yesterday's
 *            JSON snapshot) → DB + JSON snapshot + dashboard.html + (workflow
 *            commits & deploys Pages). Today's behavior.
 *  - refresh (hourly cron): read prior state from the DB (the previous run),
 *            assess event-driven (only when something changed since then), write
 *            the DB only. The live Vercel app renders fresh from the DB — no
 *            snapshot/dashboard/commit needed.
 *
 * Top-level guard: the core and adapters are built not to throw; an unforeseen
 * error here exits non-zero (so the scheduler notices) — never crash unhandled
 * or fail silently (CLAUDE.md #4).
 */

function logSurfaced(model: SitrepModel): void {
  const changes = model.changeSummary
    ? `; changes vs prior: ${model.changeSummary.new} new, ${model.changeSummary.revised} revised, ${model.changeSummary.withdrawn} possibly withdrawn`
    : "; no prior (first run — no change notes)";
  console.log(
    `surfaced ${model.surfaced.length} event(s)` +
      (model.degradation.length
        ? `; feeds unavailable: ${model.degradation.map((d) => d.feed).join(", ")}`
        : "") +
      changes,
  );
}

/** Daily / manual: JSON prior, gated assess, snapshot + dashboard + (Pages via workflow). */
async function fullRun(feedResults: FeedResult[], now: Date): Promise<void> {
  const prior = readPriorSnapshot("data", now);
  const model = buildSitrep(feedResults, prior, now);
  logSurfaced(model);

  const force = process.env.FORCE === "true";
  const assess = shouldAssess(model.changeSummary, force);
  console.log(
    assess
      ? "writing assessments (change detected, first run, or forced)"
      : "quiet run — carrying forward prior assessments (no model call)",
  );

  const { model: withFootprints, geometryById } = await fillFootprints(model, httpFootprintSource);
  const assessed = assess
    ? await fillAssessments(withFootprints, claudeCliWriter)
    : carryForwardAssessments(withFootprints, prior);

  // Snapshot FIRST — the JSON audit net (ADR 0006) must survive even if the DB
  // write below fails (sitrep.yml commits it with `if: always()`).
  writeSnapshot("data", now, assessed);

  // Per-feed fetch status for the dashboard's Data Sources panel: prefer the DB
  // (matches the Vercel route), fall back to this run's own results.
  let fetchStatus: FetchStatus | null = null;
  if (process.env.DATABASE_URL) {
    try {
      const { getDb, closeDb } = await import("./db/client.js");
      const { persistRun } = await import("./db/persist.js");
      const { lastFetchByFeed } = await import("./db/reader.js");
      try {
        const { inserted } = await persistRun(getDb(), assessed, feedResults, now, geometryById);
        console.log(`db: wrote ${inserted} new event version(s)`);
        fetchStatus = await lastFetchByFeed(getDb());
      } finally {
        await closeDb();
      }
    } catch (dbErr) {
      console.error(`db write failed (dashboard rendered from this run's results): ${String(dbErr)}`);
      process.exitCode = 1;
    }
  } else {
    console.log("db: DATABASE_URL unset — skipped DB write (snapshot-only run)");
  }
  if (!fetchStatus) {
    const okFeeds = feedResults.filter((f) => f.status === "ok").map((f) => f.feed);
    fetchStatus = {
      latestRunAt: now.getTime(),
      latestFeedsOk: okFeeds,
      lastOkByFeed: Object.fromEntries(okFeeds.map((f) => [f, now.getTime()])),
    };
  }

  // Render LAST, with the resolved status — always runs (the DB error above is
  // caught, not rethrown), so a DB blip degrades the panel rather than losing
  // the dashboard.
  writeFileSync("dashboard.html", renderDashboard(assessed, geometryById, fetchStatus), "utf8");
  console.log("wrote dashboard.html and data snapshot");
}

/** Hourly: DB prior (previous run), event-driven assess, DB write only. */
async function refreshRun(feedResults: FeedResult[], now: Date): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("SITREP_MODE=refresh requires DATABASE_URL — nothing to refresh; exiting non-zero.");
    process.exitCode = 1;
    return;
  }
  const { getDb, closeDb } = await import("./db/client.js");
  const { persistRun } = await import("./db/persist.js");
  const { latestSurfacedEvents } = await import("./db/reader.js");
  try {
    // Read the current DB latest BEFORE writing — that IS the previous run's state.
    const dbPrior = await latestSurfacedEvents(getDb());
    const priorModel: SitrepModel = {
      generatedAt: now.getTime(),
      surfaced: dbPrior,
      degradation: [],
      withdrawn: [],
      changeSummary: null,
    };

    const model = buildSitrep(feedResults, priorModel, now);
    logSurfaced(model);

    // Event-driven gate: assess only when something changed since the last run.
    // FORCE is ignored here — the hourly path is never a manual dispatch.
    const assess = shouldAssess(model.changeSummary, false);
    console.log(
      assess
        ? "refresh: change since last run — writing assessments"
        : "refresh: no change since last run — carrying forward (no model call)",
    );

    const { model: withFootprints, geometryById } = await fillFootprints(model, httpFootprintSource);
    const assessed = assess
      ? await fillAssessments(withFootprints, claudeCliWriter)
      : carryForwardAssessments(withFootprints, priorModel);

    const { inserted } = await persistRun(getDb(), assessed, feedResults, now, geometryById);
    console.log(`refresh: db wrote ${inserted} new event version(s)`);
  } finally {
    await closeDb();
  }
}

try {
  // Feeds are independent — poll concurrently; each returns a FeedResult (never
  // throws), so one feed being down never sinks the others (ADR 0008).
  const feedResults = await Promise.all([fetchUsgs(), fetchGdacs(), reliefWebSource.fetch()]);
  const now = new Date();

  if (process.env.SITREP_MODE === "refresh") {
    await refreshRun(feedResults, now);
  } else {
    await fullRun(feedResults, now);
  }
} catch (err) {
  console.error(`run failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
}
