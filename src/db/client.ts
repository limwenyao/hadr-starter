import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

let sql: ReturnType<typeof postgres> | null = null;
let db: PostgresJsDatabase<typeof schema> | null = null;

/** Lazily create the singleton Drizzle client from DATABASE_URL. */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  sql = postgres(url, { max: 1 });
  db = drizzle(sql, { schema });
  return db;
}

/** Close the pool (tests / one-shot scripts). */
export async function closeDb(): Promise<void> {
  if (sql) await sql.end({ timeout: 5 });
  sql = null;
  db = null;
}
