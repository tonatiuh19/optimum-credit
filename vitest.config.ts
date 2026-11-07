import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/** Test files that run the shared cron (see the "node-cron" project). */
const CRON_TEST_FILES = [
  "api/callInsights.integration.test.ts",
  "api/notificationQueueCron.integration.test.ts",
  "api/prospectTemperature.integration.test.ts",
];

const alias = {
  "@": path.resolve(import.meta.dirname, "client"),
  "@shared": path.resolve(import.meta.dirname, "shared"),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    env: {
      VITEST: "true",
    },
    // One run at a time on the shared TiDB + purge leftovers before / after (api/testGlobalSetup.ts).
    globalSetup: ["api/testGlobalSetup.ts"],
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "node",
          include: ["api/**/*.test.ts", "client/**/*.spec.ts"],
          exclude: CRON_TEST_FILES,
          environment: "node",
          env: { VITEST: "true" },
          // Integration tests make many round trips to a remote DB; several take 35-40 s even alone.
          // Unit tests still finish in ms.
          testTimeout: 120_000,
          hookTimeout: 90_000,
          // Tests wait on network round trips to TiDB, not CPU: 4 files at once, 2 connections per
          // pool (8 connections, was 2 files × 5). Same as groundwork.
          maxWorkers: 4,
          sequence: { groupOrder: 0 },
        },
      },
      {
        // Files that drive /api/cron/process-queue: each cron run processes
        // ANY due row in the shared DB (other files' too), so these run one
        // at a time, after the parallel node group — never concurrently.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "node-cron",
          include: CRON_TEST_FILES,
          environment: "node",
          env: { VITEST: "true" },
          testTimeout: 120_000,
          hookTimeout: 90_000,
          fileParallelism: false,
          maxWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "jsdom",
          include: ["client/**/*.spec.tsx"],
          environment: "jsdom",
          setupFiles: ["client/test/setup.ts"],
          env: { VITEST: "true" },
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
