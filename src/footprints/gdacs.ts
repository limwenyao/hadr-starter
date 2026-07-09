import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { FootprintResult } from "../types.js";
import { simplifyGeometry, eachPosition } from "./simplify.js";
import { GEOMETRY_SIMPLIFY_TOLERANCE_DEG } from "../thresholds.js";

const AREA_TYPES = new Set(["Polygon", "MultiPolygon", "LineString", "MultiLineString"]);

const HAZARD_LABELS: Record<string, string> = {
  EQ: "earthquake", TC: "tropical cyclone", FL: "flood", WF: "wildfire",
  VO: "volcano", DR: "drought", TS: "tsunami",
};

function alertColour(level: unknown): string {
  switch (typeof level === "string" ? level.toLowerCase() : "") {
    case "red": return "#ef4444";
    case "orange": return "#f59e0b";
    case "green": return "#22c55e";
    default: return "#38bdf8";
  }
}

/** Rough km radius = half the bbox diagonal (equirectangular approximation). */
function bboxRadiusKm(features: Feature[]): number {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const f of features) {
    eachPosition(f.geometry, (p: Position) => {
      minLon = Math.min(minLon, p[0]); maxLon = Math.max(maxLon, p[0]);
      minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]);
    });
  }
  if (!Number.isFinite(minLon)) return 0;
  const midLat = ((minLat + maxLat) / 2) * Math.PI / 180;
  const dLatKm = (maxLat - minLat) * 111;
  const dLonKm = (maxLon - minLon) * 111 * Math.cos(midLat);
  return Math.round(Math.hypot(dLatKm, dLonKm) / 2);
}

/** getgeometry FeatureCollection → normalized modeled-area footprint, or undefined. */
export function summariseGdacsGeometry(fc: unknown, hazardType: string): FootprintResult | undefined {
  const features = (fc as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return undefined;

  const kept: Feature[] = [];
  for (const raw of features) {
    const f = raw as { properties?: { alertlevel?: unknown }; geometry?: Geometry };
    if (!f.geometry || !AREA_TYPES.has(f.geometry.type)) continue;   // drop centroid Point
    kept.push({
      type: "Feature",
      geometry: simplifyGeometry(f.geometry, GEOMETRY_SIMPLIFY_TOLERANCE_DEG),
      properties: { provenance: "gdacs", isEstimate: false, color: alertColour(f.properties?.alertlevel) },
    });
  }
  if (kept.length === 0) return undefined;

  const hazard = HAZARD_LABELS[hazardType] ?? hazardType;
  const geometry: FeatureCollection = { type: "FeatureCollection", features: kept };
  return {
    summary: {
      provenance: "gdacs",
      label: `Modeled affected area (GDACS · ${hazard})`,
      isEstimate: false,
      radiusKm: bboxRadiusKm(kept),
    },
    geometry,
  };
}
