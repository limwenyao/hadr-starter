import type { Event, Tier } from "../types.js";
import {
  PAGER_CRITICAL_ALERTS,
  USGS_CRITICAL_MAG,
  USGS_HIGH_MAG,
  USGS_NOISE_FLOOR_MAG,
} from "../thresholds.js";

/** Deterministic rules only — no model in the selection path (ADR 0003). */

function isPagerCritical(event: Event): boolean {
  return (
    event.metrics.pagerAlert !== undefined &&
    PAGER_CRITICAL_ALERTS.includes(event.metrics.pagerAlert)
  );
}

/**
 * Noise floor (ADR 0004): USGS M >= 4.5. Impact-aware extension: a PAGER
 * orange/red event always surfaces regardless of magnitude — the cardinal
 * rule is never miss a major event (recorded in implementation-notes.md).
 */
export function passesNoiseFloor(event: Event): boolean {
  if (event.feed === "USGS") {
    const mag = event.metrics.mag ?? Number.NEGATIVE_INFINITY;
    return mag >= USGS_NOISE_FLOOR_MAG || isPagerCritical(event);
  }
  // GDACS / ReliefWeb land in later slices (ADR 0010).
  return false;
}

/** Priority tier (ADR 0004). Call only on events that passed the noise floor. */
export function tierFor(event: Event): Tier {
  const mag = event.metrics.mag ?? Number.NEGATIVE_INFINITY;
  if (isPagerCritical(event) || mag >= USGS_CRITICAL_MAG) return "CRITICAL";
  if (mag >= USGS_HIGH_MAG) return "HIGH";
  return "MODERATE";
}
