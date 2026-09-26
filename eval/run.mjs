#!/usr/bin/env node
/**
 * Launcher for eval runner using tsx.
 */

import { spawnSync } from "child_process";
import path from "path";
import fs from "fs";

const args = process.argv.slice(2);
const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");

let result;
if (fs.existsSync(tsxCli)) {
  result = spawnSync(process.execPath, [tsxCli, "eval/runner.ts", ...args], {
    stdio: "inherit",
  });
} else {
  result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "eval/runner.ts", ...args], {
    stdio: "inherit",
  });
}

process.exit(result.status ?? 1);

