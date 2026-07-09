import type { SitrepModel } from "../types.js";

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
