#!/usr/bin/env node
/**
 * CLI Executable Entry Point
 *
 * Usage: npx tsx src/cli/main.ts "Fix bug in index.ts" --workspace ./my-project
 */

import { runCli } from "./runner.js";

async function main() {
  const result = await runCli(process.argv.slice(2), process.env);
  process.exit(result.exitCode);
}

main().catch((err: unknown) => {
  console.error("Fatal CLI error:", err);
  process.exit(1);
});
