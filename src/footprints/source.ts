import type { FootprintResult, SurfacedEvent } from "../types.js";
import type { FootprintSource } from "./fill.js";
import { summariseShakeMap } from "./shakemap.js";
import { summariseGdacsGeometry } from "./gdacs.js";
import { estimateFootprint } from "./estimate.js";
import { FOOTPRINT_FETCH_TIMEOUT_MS } from "../thresholds.js";

const UA = { "user-agent": "hadr-monitor (workshop build)" };

async function getJson(url: string): Promise<unknown> {
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
