import { defineConfig } from "tsup";

/**
 * Build configuration.
 *
 * We emit a single ESM bundle per entry. The CLI entry gets a shebang via
 * `banner` so the `kohala` bin is directly executable after install.
 */
export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  splitting: false,
  // `pg` is an optional peer dependency: it must stay external so installs
  // without it still work (the postgres backend lazy-imports it).
  external: ["pg"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
