// SPDX-FileCopyrightText: 2026 Dang Nguyen <haidang009@outlook.com>
// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, startServer } from "./server/server.ts";

interface CliOptions {
  port: number;
  openBrowser: boolean;
}

/**
 * Appropriate Legal Notices, per AGPL-3.0 section 5(d): copyright, absence of
 * warranty, redistribution terms, and where to find the license and source.
 */
const LEGAL_NOTICE = `caro-tournament  Copyright (C) 2026  Dang Nguyen
This program comes with ABSOLUTELY NO WARRANTY. It is free software under the
GNU Affero General Public License v3.0, and you are welcome to redistribute it
under those terms; see <https://www.gnu.org/licenses/agpl-3.0.html>.
Source: https://github.com/panda-on-pedal/caro-engine`;

function printUsage(): void {
  console.log(`Usage: caro-tournament [options]

Options:
  --port <number>   Port to listen on (default: ${DEFAULT_PORT})
  --no-open         Do not open the browser
  -h, --help        Show this help

${LEGAL_NOTICE}
`);
}

function parseArgs(argv: string[]): CliOptions {
  let port = DEFAULT_PORT;
  let openBrowser = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--no-open") {
      openBrowser = false;
      continue;
    }
    if (arg === "--port") {
      const value = argv[i + 1];
      if (!value || Number.isNaN(Number(value))) {
        console.error("Error: --port requires a number");
        process.exit(1);
      }
      port = Number(value);
      i += 1;
      continue;
    }
    console.error(`Error: unknown option ${arg}`);
    printUsage();
    process.exit(1);
  }

  return { port, openBrowser };
}

/** Package root: parent of dist/ when running the published CLI bundle. */
function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}

function dataDir(): string {
  return join(homedir(), ".caro-tournament");
}

function openInBrowser(url: string): void {
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const url = `http://localhost:${options.port}`;

  try {
    await startServer({
      assetRoot: join(packageRoot(), "dist", "ui"),
      dataDir: dataDir(),
      port: options.port,
    });
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code === "EADDRINUSE") {
      console.error(`Error: port ${options.port} is already in use. Try --port <number>.`);
      process.exit(1);
    }
    throw error;
  }

  console.log(LEGAL_NOTICE);
  console.log("");
  console.log(`Caro tournament listening on ${url}`);
  console.log(`Game data: ${dataDir()}`);

  if (options.openBrowser) {
    openInBrowser(url);
  }
}

await main();
