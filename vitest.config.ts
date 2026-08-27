import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const alias = {
  "@": path.resolve(__dirname, "client"),
  "@shared": path.resolve(__dirname, "shared"),
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
          environment: "node",
          env: { VITEST: "true" },
          // TiDB Cloud under parallel integration load is often >5s/request;
          // default Vitest timeouts flake deploy. Unit tests still finish in ms.
          testTimeout: 20_000,
          hookTimeout: 90_000,
          // Cap parallel integration files — each opens pools against shared TiDB.
          fileParallelism: 2,
          maxWorkers: 2,
          sequence: { groupOrder: 0 },
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
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
