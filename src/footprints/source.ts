import type { FootprintResult, SurfacedEvent } from "../types.js";
import type { FootprintSource } from "./fill.js";
import { summariseShakeMap } from "./shakemap.js";
import { summariseGdacsGeometry } from "./gdacs.js";
import { estimateFootprint } from "./estimate.js";
import { FOOTPRINT_FETCH_TIMEOUT_MS } from "../thresholds.js";

const UA = { "user-agent": "hadr-monitor (workshop build)" };

/**
 * Hosts (and their subdomains) the footprint fetcher may reach. Both the
 * per-event `footprintRef` and the second-order ShakeMap `contUrl` come from
 * untrusted feed payloads, so we restrict fetches to the known feed origins —
 * an https + allowed-host check that closes an SSRF vector (cloud metadata at
 * 169.254.169.254, localhost admin endpoints, etc.). This is stricter than
 * the `sourceUrl` sanitization in render/viewModel.ts (which allows any
 * http(s) host): footprint URLs must be https AND on a known feed host.
 */
const ALLOWED_FOOTPRINT_HOST_SUFFIXES = ["usgs.gov", "gdacs.org"] as const;

/** True only for an https URL whose host is (a subdomain of) an allowed feed host. Pure. */
export function isAllowedFootprintUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED_FOOTPRINT_HOST_SUFFIXES.some(
    (s) => host === s || host.endsWith(`.${s}`),
  );
}

async function getJson(url: string): Promise<unknown> {
  // Never fetch a feed-supplied URL that isn't an allowed feed origin (SSRF guard).
  if (!isAllowedFootprintUrl(url)) {
    throw new Error(`disallowed footprint URL (not an https feed host): ${url}`);
  }
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(FOOTPRINT_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** USGS: follow the detail feed → ShakeMap cont_mmi.json; else estimate ring. */
async function usgsFootprint(event: SurfacedEvent): Promise<FootprintResult | undefined> {
  const { coordinates: c, metrics } = event;
  const estimate = () => (c ? estimateFootprint(c.lon, c.lat, metrics.mag, c.depthKm) : undefined);
  if (!event.footprintRef) return estimate();
  try {
    const detail = await getJson(event.footprintRef);
    const products = (detail as any)?.properties?.products;
    const contUrl = products?.shakemap?.[0]?.contents?.["download/cont_mmi.json"]?.url;
    if (typeof contUrl === "string") {
      const summary = summariseShakeMap(await getJson(contUrl));
      if (summary) return summary;
    }
  } catch (err) {
    console.error(`USGS footprint fetch failed for ${event.feedEventId}: ${String(err)}`);
  }
  return estimate(); // no ShakeMap (tiny quake) or fetch failed → estimate ring
}

/** GDACS: fetch getgeometry → normalized polygons. No estimate fallback. */
async function gdacsFootprint(event: SurfacedEvent): Promise<FootprintResult | undefined> {
  if (!event.footprintRef) return undefined;
  try {
    return summariseGdacsGeometry(await getJson(event.footprintRef), event.hazardType);
  } catch (err) {
    console.error(`GDACS footprint fetch failed for ${event.feedEventId}: ${String(err)}`);
    return undefined;
  }
}

/** Production source. ReliefWeb (no coords) always yields no zone. */
export const httpFootprintSource: FootprintSource = {
  async forEvent(event) {
    if (!event.coordinates) return undefined;
    if (event.feed === "USGS") return usgsFootprint(event);
    if (event.feed === "GDACS") return gdacsFootprint(event);
    return undefined;
  },
};
