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
          // TiDB Cloud under parallel integration load is often >5s/request;
          // multi-request hub/voice tests need headroom beyond 20s or deploy flakes.
          // Unit tests still finish in ms.
          testTimeout: 45_000,
          hookTimeout: 90_000,
          // Cap parallel integration files — each opens pools against shared TiDB.
          fileParallelism: 2,
          maxWorkers: 2,
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
          testTimeout: 45_000,
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
