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

/**
 * Change detection vs the prior snapshot (ADR 0009).
 */

/** Magnitude revisions smaller than this are jitter, not a material change. */
export const MAG_REVISION_MIN = 0.1;

/**
 * A previously-reported event missing from its feed is flagged "possibly
 * withdrawn" only while its event time is still inside the feed's rolling
 * visibility window — beyond it, disappearing is just normal aging-out
 * (USGS all_day spans 24 h; GDACS current-events treated the same).
 */
export const FEED_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Prompt-injection hardening (debt #11). Untrusted feed free-text (event title,
 * location name) is neutralized before it enters the assessment prompt: control
 * characters stripped, length capped. Feed titles/place names are short; longer
 * is almost certainly a payload.
 */
export const MAX_FIELD_CHARS = 200;

/**
 * `claude -p` invocation timeout (assessment writer adapter). Unlike feed
 * adapters (AbortSignal.timeout(30_000)), a batched-prompt model call over one
 * run's surfaced events legitimately takes longer than a feed fetch — 3 minutes
 * is generous headroom while still guaranteeing the run cannot hang forever
 * (a hung run would also queue behind the next day's, since the workflow uses
 * concurrency: cancel-in-progress: false).
 */
export const CLAUDE_CLI_TIMEOUT_MS = 180_000;

/**
 * ── Impact zones (impact-zones slice) ────────────────────────────────────
 * Estimated felt-radius model. A documented depth-aware intensity prediction
 * equation of the standard active-crustal form
 *     MMI = IPE_C0 + IPE_C1 * M + IPE_C2 * log10(R_hyp_km)
 * solved for the hypocentral distance at which MMI == FELT_MMI_THRESHOLD, then
 * projected to a surface (epicentral) radius. Coefficients are CALIBRATED so
 * outputs are physically sane (shallow M5 ~70 km, M6.5 ~300 km felt radius) —
 * they are NOT the exact Allen-Wald-Worden (2012) table (unverifiable in this
 * build). This is the single tuning point; swap in published coefficients here.
 * The ring is always rendered as an ESTIMATE (dashed, captioned).
 */
export const FELT_MMI_THRESHOLD = 3.5;
export const IPE_C0 = 2.5;
export const IPE_C1 = 1.5;
export const IPE_C2 = -3.5;
/** Cap so a great-quake estimate ring cannot become absurdly large. */
export const EST_MAX_RADIUS_KM = 1000;
/** Vertices used to approximate the estimate ring circle. */
export const EST_RING_POINTS = 64;
/** Ramer-Douglas-Peucker tolerance (degrees) for embedded footprint geometry. */
export const GEOMETRY_SIMPLIFY_TOLERANCE_DEG = 0.01;
/** Per-event footprint fetch timeout (matches the feed-adapter convention). */
export const FOOTPRINT_FETCH_TIMEOUT_MS = 30_000;
/** Max events fetched concurrently in fillFootprints — poll feeds politely, ADR 0008. */
export const FOOTPRINT_FETCH_CONCURRENCY = 6;
/** Kilometres per degree of latitude — for rough equirectangular bbox sizing. */
export const KM_PER_DEG_LAT = 111;
