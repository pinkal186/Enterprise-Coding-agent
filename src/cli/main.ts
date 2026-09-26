#!/usr/bin/env node
/**
 * CLI Executable Entry Point (Iteration 2)
 *
 * Usage: npx tsx src/cli/main.ts "Fix bug in index.ts" --workspace ./my-project [--debug-context]
 */

import { runCli } from "./runner.js";

export { runCli };

export async function main(): Promise<void> {
  const result = await runCli(process.argv.slice(2), process.env);
  process.exit(result.exitCode);
}

main().catch((err: unknown) => {
  console.error("Fatal CLI error:", err);
  process.exit(1);
});
