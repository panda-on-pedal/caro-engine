import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error -- plain ESM helper shared with scripts/build-bundles.mjs
import { legalBanner } from "./scripts/legalBanner.mjs";

const rootDir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8")) as {
  version: string;
};

/**
 * Prepend the AGPL notice to every emitted JS/CSS asset.
 *
 * `rollupOptions.output.banner` is not enough: the minifier runs afterwards and
 * strips the comment. `generateBundle` is the last hook before assets are
 * written, so the notice is guaranteed to survive into dist/.
 */
function legalBannerPlugin(version: string) {
  const banner = legalBanner(version) as string;
  return {
    name: "caro-legal-banner",
    enforce: "post" as const,
    generateBundle(_options: unknown, bundle: Record<string, unknown>) {
      for (const asset of Object.values(bundle)) {
        const chunk = asset as { type: string; fileName: string; code?: string; source?: unknown };
        if (chunk.type === "chunk" && typeof chunk.code === "string") {
          chunk.code = `${banner}\n${chunk.code}`;
        } else if (chunk.fileName.endsWith(".css") && typeof chunk.source === "string") {
          chunk.source = `${banner}\n${chunk.source}`;
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [svelte(), legalBannerPlugin(pkg.version)],
  root: rootDir,
  publicDir: "public",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEBUG__: JSON.stringify(mode !== "production"),
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(rootDir, "index.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:2026",
    },
  },
}));
