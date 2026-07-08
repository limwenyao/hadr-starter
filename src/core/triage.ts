import type { Event, Tier } from "../types.js";
import {
  GDACS_CRITICAL_ALERT,
  GDACS_SURFACE_ALERTS,
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

function gdacsSurfaces(event: Event): boolean {
  return (
    event.metrics.alertLevel !== undefined &&
    GDACS_SURFACE_ALERTS.includes(event.metrics.alertLevel)
  );
}

/**
 * Noise floor (ADR 0004). USGS: M >= 4.5, with the impact-aware extension that a
 * PAGER orange/red event always surfaces regardless of magnitude. GDACS: Orange +
 * Red surface, Green is noise. The cardinal rule is never miss a major event
 * (recorded in implementation-notes.md).
 */
export function passesNoiseFloor(event: Event): boolean {
  if (event.feed === "USGS") {
    const mag = event.metrics.mag ?? Number.NEGATIVE_INFINITY;
    return mag >= USGS_NOISE_FLOOR_MAG || isPagerCritical(event);
  }
  if (event.feed === "GDACS") {
    return gdacsSurfaces(event);
  }
  // ReliefWeb lands in a later slice (ADR 0010).
  return false;
}

/**
 * Priority tier (ADR 0004). Precondition: the event has passed `passesNoiseFloor`.
 * Not enforced at runtime — a sub-floor event would just be assigned the MODERATE tier, and
 * throwing here would violate the core's no-crash contract (CLAUDE.md #4). The sole
 * caller (`buildSitrep`) filters through the noise floor immediately before this.
 */
export function tierFor(event: Event): Tier {
  if (event.feed === "GDACS") {
    return event.metrics.alertLevel === GDACS_CRITICAL_ALERT ? "CRITICAL" : "HIGH";
  }
  const mag = event.metrics.mag ?? Number.NEGATIVE_INFINITY;
  if (isPagerCritical(event) || mag >= USGS_CRITICAL_MAG) return "CRITICAL";
  if (mag >= USGS_HIGH_MAG) return "HIGH";
  return "MODERATE";
}
