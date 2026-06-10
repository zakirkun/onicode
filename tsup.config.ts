/**
 * tsup build configuration for OniCode CLI.
 *
 * Produces:
 * - `dist/cli.js` — executable entrypoint with shebang for `npx onicode` and `bin` linking.
 * - `dist/index.js` — programmatic library entrypoint for embedding OniCode in other tools.
 *
 * Format: ESM only (Node 20+). React Ink is ESM-only as of v5.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli/index.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  treeshake: true,
  minify: false,
  // Preserve shebang on the CLI entrypoint so the binary is directly executable.
  banner: ({ format }) => {
    if (format === "esm") {
      return { js: "#!/usr/bin/env node" };
    }
    return {};
  },
});
