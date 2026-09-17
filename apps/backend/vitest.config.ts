import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    // Tests share one local sqlite file and delete its rows between cases —
    // SQLite is single-writer, and running files in parallel would race on
    // that shared state regardless.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
