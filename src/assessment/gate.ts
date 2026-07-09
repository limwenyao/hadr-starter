import type { SitrepModel } from "../types.js";
import { FALLBACK_ASSESSMENT } from "./writer.js";

/**
 * The scheduled quiet-gate (ADR 0010): decides whether this run should (re)write
 * the model assessment. Pure and deterministic — the model NEVER decides whether
 * the run wakes up (CLAUDE.md #2). True when forced (manual dispatch), on the
 * first run (no prior snapshot), or when the change verdict is non-zero.
 */
export function shouldAssess(
  changeSummary: SitrepModel["changeSummary"],
  force: boolean,
): boolean {
  if (force) return true;
  if (changeSummary === null) return true;
  return (
    changeSummary.new > 0 ||
    changeSummary.revised > 0 ||
    changeSummary.withdrawn > 0
  );
}

/**
 * Quiet-day assessment (ADR 0010 gate): the change verdict was all-zero, so the
 * surfaced set matches the prior snapshot exactly — reuse its assessment prose
 * instead of calling the model. Any unexpected miss (or no prior) degrades to
 * FALLBACK_ASSESSMENT — never blank (CLAUDE.md #4). Returns a fresh object;
 * callers never share mutable state (matches fillAssessments' contract).
 */
export function carryForwardAssessments(
  model: SitrepModel,
  prior: SitrepModel | null,
): SitrepModel {
  const priorProse = new Map(
    (prior?.surfaced ?? []).map((e) => [e.feedEventId, e.assessment]),
  );
  return {
    ...model,
    surfaced: model.surfaced.map((e) => ({
      ...e,
      assessment: priorProse.get(e.feedEventId) ?? FALLBACK_ASSESSMENT,
    })),
  };
}
