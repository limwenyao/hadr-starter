import type { PagerAlert } from "./types.js";

/**
 * ADR 0004 — conservative noise floor and three-tier priority.
 * The single tunable place: change values here, never inline elsewhere.
 */

/** USGS events below this magnitude are noise (unless PAGER-critical). */
export const USGS_NOISE_FLOOR_MAG = 4.5;

/** USGS M >= this (and < critical) is HIGH. */
export const USGS_HIGH_MAG = 5.5;

/** USGS M >= this is CRITICAL. */
export const USGS_CRITICAL_MAG = 6.5;

/** PAGER impact levels that promote an event to CRITICAL (impact-aware rule). */
export const PAGER_CRITICAL_ALERTS: readonly PagerAlert[] = ["orange", "red"];
