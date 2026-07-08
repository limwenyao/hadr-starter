import type { GdacsAlertLevel, PagerAlert } from "./types.js";

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

/** GDACS alert levels loud enough to surface (Green is noise — ADR 0004). */
export const GDACS_SURFACE_ALERTS: readonly GdacsAlertLevel[] = ["orange", "red"];

/** GDACS alert level that is CRITICAL (Orange is HIGH — ADR 0004). */
export const GDACS_CRITICAL_ALERT: GdacsAlertLevel = "red";

/**
 * Duplicate flagging (ADR 0007). Two events from different feeds are likely the
 * same physical event when same hazard type, within this time window, and within
 * this distance. Conservative starting values, tunable.
 */
export const DUP_TIME_WINDOW_MS = 90 * 60_000; // ±90 minutes
export const DUP_DISTANCE_KM = 100;
