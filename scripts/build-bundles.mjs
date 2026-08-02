// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * esbuild bundles for the CLI and the engine worker.
 *
 * These were plain `esbuild` CLI invocations in package.json; they moved here
 * so both bundles carry the same legal banner as the Vite build.
 *
 *   node scripts/build-bundles.mjs cli
 *   node scripts/build-bundles.mjs worker [--debug]
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { legalBanner } from "./legalBanner.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
const banner = legalBanner(pkg.version);

const target = process.argv[2];
const debug = process.argv.includes("--debug");

const targets = {
  cli: {
    entryPoints: [resolve(rootDir, "src/cli.ts")],
    outfile: resolve(rootDir, "dist/cli.js"),
    platform: "node",
    format: "esm",
    banner: { js: `#!/usr/bin/env node\n${banner}` },
  },
  worker: {
    entryPoints: [resolve(rootDir, "src/ui/engineWorker.ts")],
    outfile: resolve(rootDir, "dist/ui/engineWorker.js"),
    define: { __DEBUG__: JSON.stringify(debug) },
    banner: { js: banner },
  },
};

if (!Object.hasOwn(targets, target)) {
  console.error(`usage: build-bundles.mjs <${Object.keys(targets).join("|")}> [--debug]`);
  process.exit(1);
}

await build({ bundle: true, ...targets[target] });
