import type { Geometry, Position } from "geojson";

/** Perpendicular distance from point p to the segment a→b (planar, degrees). */
function segDist(p: Position, a: Position, b: Position): number {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + tc * dx), py - (ay + tc * dy));
}

/** Ramer-Douglas-Peucker on a single line of positions. Endpoints preserved. */
function rdp(points: Position[], tol: number): Position[] {
  if (points.length <= 2) return points;
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]];
  const left = rdp(points.slice(0, idx + 1), tol);
  const right = rdp(points.slice(idx), tol);
  return left.slice(0, -1).concat(right);
}

/** Simplify any GeoJSON geometry's coordinate arrays with RDP (tolerance in degrees). */
export function simplifyGeometry(geometry: Geometry, toleranceDeg: number): Geometry {
  switch (geometry.type) {
    case "LineString":
      return { type: "LineString", coordinates: rdp(geometry.coordinates, toleranceDeg) };
    case "MultiLineString":
      return { type: "MultiLineString", coordinates: geometry.coordinates.map((l) => rdp(l, toleranceDeg)) };
    case "Polygon":
      return { type: "Polygon", coordinates: geometry.coordinates.map((r) => rdp(r, toleranceDeg)) };
    case "MultiPolygon":
      return { type: "MultiPolygon", coordinates: geometry.coordinates.map((poly) => poly.map((r) => rdp(r, toleranceDeg))) };
    default:
      return geometry; // Point / GeometryCollection etc. pass through untouched
  }
}

/** Visit every Position in a geometry (Point/Line/Poly/Multi/GeometryCollection). */
export function eachPosition(geometry: Geometry, fn: (pos: Position) => void): void {
  if ("geometries" in geometry) {
    geometry.geometries.forEach((g) => eachPosition(g, fn));
    return;
  }
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") { fn(c as Position); return; }
    if (Array.isArray(c)) c.forEach(walk);
  };
  if ("coordinates" in geometry) walk((geometry as { coordinates: unknown }).coordinates);
}
