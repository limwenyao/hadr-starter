import type { Polygon } from "geojson";
import type { FootprintResult } from "../types.js";
import {
  FELT_MMI_THRESHOLD, IPE_C0, IPE_C1, IPE_C2, EST_MAX_RADIUS_KM, EST_RING_POINTS,
} from "../thresholds.js";

/** Muted estimate colour (independent of the CSS tier ramp — client reads it). */
export const ESTIMATE_COLOUR = "#7d95b5";

const EARTH_RADIUS_KM = 6371;

/**
 * Surface (epicentral) felt radius in km, or undefined when no drawable ring.
 * Depth-aware IPE (see thresholds.ts): solve MMI==FELT_MMI_THRESHOLD for the
 * hypocentral distance, then project to the surface. An explicit ESTIMATE.
 */
export function estimateFeltRadiusKm(
  mag: number | undefined,
  depthKm = 0,
): number | undefined {
  if (typeof mag !== "number" || !Number.isFinite(mag)) return undefined;
  // FELT = C0 + C1*M + C2*log10(Rhyp)  =>  Rhyp = 10 ^ ((FELT - C0 - C1*M)/C2)
  const logR = (FELT_MMI_THRESHOLD - IPE_C0 - IPE_C1 * mag) / IPE_C2;
  const rHyp = Math.pow(10, logR);
  const h = Number.isFinite(depthKm) && depthKm > 0 ? depthKm : 0;
  if (rHyp <= h) return undefined;            // too deep to be felt at threshold
  const rEpi = Math.sqrt(rHyp * rHyp - h * h);
  const capped = Math.min(rEpi, EST_MAX_RADIUS_KM);
  return capped > 0 ? capped : undefined;
}

/** A closed circular ring (points+1 positions) approximating a geodesic circle. */
export function circlePolygon(
  lon: number, lat: number, radiusKm: number, points: number,
): Polygon {
  const latRad = (lat * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const brng = (2 * Math.PI * i) / points;
    const dLat = (radiusKm / EARTH_RADIUS_KM) * Math.cos(brng);
    const dLon =
      (radiusKm / (EARTH_RADIUS_KM * Math.cos(latRad))) * Math.sin(brng);
    ring.push([lon + (dLon * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** Estimate footprint for an earthquake, or undefined when nothing is drawable. */
export function estimateFootprint(
  lon: number, lat: number, mag: number | undefined, depthKm = 0,
): FootprintResult | undefined {
  const r = estimateFeltRadiusKm(mag, depthKm);
  if (r === undefined) return undefined;
  const ring = circlePolygon(lon, lat, r, EST_RING_POINTS);
  return {
    summary: {
      provenance: "estimated",
      label: "Estimated felt radius",
      isEstimate: true,
      radiusKm: Math.round(r),
    },
    geometry: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: ring,
        properties: { provenance: "estimated", isEstimate: true, color: ESTIMATE_COLOUR },
      }],
    },
  };
}
