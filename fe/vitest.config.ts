import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": src },
  },
  test: {
    globals: true,
    passWithNoTests: true,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/money.ts", "src/lib/rates.ts", "src/lib/finance/**"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
    // Libraries and services run in node; component tests (.test.tsx) run in jsdom.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          // Non-UTC on purpose: date-only logic must not depend on the process time zone.
          env: { TZ: "America/New_York" },
          include: ["tests/**/*.test.ts", "src/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: ["node_modules", ".next", "tests/e2e/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx", "src/**/*.test.tsx"],
          exclude: ["node_modules", ".next", "tests/e2e/**"],
        },
      },
    ],
  },
});
