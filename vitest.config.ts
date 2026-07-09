import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The DB integration tests (db-integration, db-persist) share one Postgres
    // and TRUNCATE it between cases. Vitest runs test files in parallel workers
    // by default, so concurrent files would wipe each other's rows mid-test —
    // an intermittent CI failure (ADR 0011). Serialise file execution: the whole
    // suite runs in ~2s, so the cost is negligible and DB isolation is guaranteed.
    fileParallelism: false,
  },
});
