import { getDb } from "../src/db/client.js";
import { latestSurfacedEvents } from "../src/db/reader.js";
import { buildDbSitrepModel } from "../src/render/fromDb.js";
import { renderDashboard } from "../src/render/dashboard.js";

export const dynamic = "force-dynamic"; // always read current DB state

export async function GET() {
  try {
    const events = await latestSurfacedEvents(getDb());
    const model = buildDbSitrepModel(events, new Date());
    // Slice 1: impact geometry is not persisted, so render with no polygons.
    const html = renderDashboard(model, {});
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      `<!doctype html><meta charset=utf-8><body style="font:14px system-ui;padding:2rem">` +
      `<h1>HADR Monitor</h1><p>Dashboard data is temporarily unavailable.</p>` +
      `<p style="color:#888">(${msg.replace(/</g, "&lt;")})</p>`,
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}
