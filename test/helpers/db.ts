import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { getDb, closeDb } from "../../src/db/client.js";

export async function resetDb() {
  const db = getDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.execute(sql`TRUNCATE TABLE event_versions RESTART IDENTITY`);
  await db.execute(sql`TRUNCATE TABLE ingest_runs`);
  return db;
}
export { closeDb };
