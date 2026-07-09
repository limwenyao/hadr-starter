import type { Feature, FeatureCollection } from "geojson";
import type { FootprintResult } from "../types.js";
import { simplifyGeometry } from "./simplify.js";
import { GEOMETRY_SIMPLIFY_TOLERANCE_DEG } from "../thresholds.js";

const LINE_TYPES = new Set(["LineString", "MultiLineString"]);
const DEFAULT_COLOUR = "#38bdf8";

/** Parsed cont_mmi.json → normalized modeled-shaking footprint, or undefined. */
export function summariseShakeMap(contFc: unknown): FootprintResult | undefined {
  const features = (contFc as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return undefined;

  const out: Feature[] = [];
  let maxMmi = -Infinity;
  for (const raw of features) {
    const f = raw as { properties?: { value?: unknown; color?: unknown }; geometry?: { type?: string } };
    if (!f.geometry || !LINE_TYPES.has(f.geometry.type ?? "")) continue;
    const value = f.properties?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    maxMmi = Math.max(maxMmi, value);
    out.push({
      type: "Feature",
      geometry: simplifyGeometry(f.geometry as any, GEOMETRY_SIMPLIFY_TOLERANCE_DEG),
      properties: {
        provenance: "shakemap",
        isEstimate: false,
        color: typeof f.properties?.color === "string" ? f.properties.color : DEFAULT_COLOUR,
      },
    });
  }
  if (out.length === 0) return undefined;

  const geometry: FeatureCollection = { type: "FeatureCollection", features: out };
  return {
    summary: { provenance: "shakemap", label: "Modeled shaking (USGS ShakeMap)", isEstimate: false, maxMmi },
    geometry,
  };
}
