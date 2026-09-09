#!/usr/bin/env node
/**
 * Launcher for eval runner using tsx.
 */

import { spawnSync } from "child_process";

const args = process.argv.slice(2);

const result = spawnSync("npx", ["tsx", "eval/runner.ts", ...args], {
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
