import { getDb } from "../../../src/db/client.js";
import { latestSurfacedEvents } from "../../../src/db/reader.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const events = await latestSurfacedEvents(getDb());
  return Response.json({ events });
}
