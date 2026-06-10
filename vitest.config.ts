/**
 * Vitest configuration for OniCode.
 *
 * - Node environment (no DOM): the CLI runs on Node, and Ink components are tested
 *   with Ink's own test renderer rather than jsdom.
 * - Globals enabled so `describe`, `it`, `expect` are ambient (matches Jest ergonomics).
 * - Coverage uses v8 provider; excludes generated and config files.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/types.ts",
        "src/cli/index.ts",
        "src/index.ts",
        "dist/**",
      ],
    },
  },
});
