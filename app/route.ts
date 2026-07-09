import { getDb } from "../src/db/client.js";
import { latestSurfacedEvents, latestGeometryById } from "../src/db/reader.js";
import { buildDbSitrepModel } from "../src/render/fromDb.js";
import { renderDashboard } from "../src/render/dashboard.js";

export const dynamic = "force-dynamic"; // always read current DB state

export async function GET() {
  try {
    const db = getDb();
    const [events, geometryById] = await Promise.all([
      latestSurfacedEvents(db),
      // Geometry is best-effort: no polygons beats a 503 if only the geometry
      // read fails (the essential events read is still guarded by the catch).
      latestGeometryById(db).catch(() => ({})),
    ]);
    const model = buildDbSitrepModel(events, new Date());
    const html = renderDashboard(model, geometryById);
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (err) {
    // Log the real error server-side for operators; never reflect DB internals
    // (Neon host, credentials, driver text) to anonymous visitors in the 503.
    console.error("dashboard route: render from DB failed:", err);
    return new Response(
      `<!doctype html><meta charset=utf-8><body style="font:14px system-ui;padding:2rem">` +
      `<h1>HADR Monitor</h1><p>Dashboard data is temporarily unavailable. Please try again shortly.</p>`,
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}
