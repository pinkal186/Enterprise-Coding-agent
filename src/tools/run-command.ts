/**
 * Run Command Tool
 *
 * Executes shell commands within the workspace under a configurable timeout,
 * enforcing command safety policies (AC-4) and output byte caps (NFR-4).
 */

import { exec } from "child_process";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.js";
import type { ToolDefinition } from "../llm/types.js";
import { SafetyPolicy } from "../safety/policy.js";

export const RunCommandInputSchema = z.object({
  command: z.string().min(1, "Command cannot be empty"),
  timeoutMs: z.number().int().min(1000).max(120000).optional().default(30000),
  cwd: z.string().optional().default("."),
});

export type RunCommandInput = z.infer<typeof RunCommandInputSchema>;

export const DEFAULT_MAX_COMMAND_OUTPUT_BYTES = 50 * 1024; // 50 KB cap

export class RunCommandTool implements Tool<RunCommandInput> {
  readonly name = "run_command";
  readonly description =
    "Execute an allowlisted shell command (e.g. 'npm test', 'npm run build', 'node script.js') within the workspace. Captures exit code, stdout, and stderr under a timeout.";
  readonly inputSchema = RunCommandInputSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute (must match allowlisted patterns).",
          },
          timeoutMs: {
            type: "number",
            description: "Maximum execution time in milliseconds before timeout (default: 30000).",
          },
          cwd: {
            type: "string",
            description: "Optional relative directory within workspace to run in (default: '.').",
          },
        },
        required: ["command"],
      },
    };
  }

  async execute(input: RunCommandInput, context: ToolContext) {
    // 1. Enforce workspace safety boundary on cwd
    const targetDir = input.cwd || ".";
    const pathValidation = SafetyPolicy.validateWorkspacePath(context.workspaceRoot, targetDir);
    if (!pathValidation.allowed) {
      return {
        success: false,
        output: "",
        error: pathValidation.reason || "Execution directory is outside the allowed workspace",
      };
    }

    const workingDirectory = pathValidation.resolvedPath;

    // 2. Enforce command safety allowlist (AC-4)
    const commandValidation = SafetyPolicy.validateCommand(input.command);
    if (!commandValidation.allowed) {
      return {
        success: false,
        output: "",
        error: commandValidation.reason || `Command safety DENY for '${input.command}'`,
      };
    }

    // 3. Execute command with timeout
    const timeoutMs = input.timeoutMs || 30000;

    return new Promise<{ success: boolean; output: string; error?: string }>((resolve) => {
      let isTimedOut = false;

      const child = exec(
        input.command,
        {
          cwd: workingDirectory,
          timeout: timeoutMs,
          maxBuffer: 5 * 1024 * 1024, // 5MB internal buffer before exec kills
          env: {
            ...process.env,
            CI: "true",
            FORCE_COLOR: "0",
          },
        },
        (err, stdout, stderr) => {
          let outStr = stdout ? stdout.toString() : "";
          let errStr = stderr ? stderr.toString() : "";

          // Check if error was due to timeout
          if (err && (err.killed || (err as unknown as { signal?: string }).signal === "SIGTERM")) {
            isTimedOut = true;
          }

          // Truncate output if exceeding max bytes (NFR-4)
          let truncated = false;
          if (outStr.length > DEFAULT_MAX_COMMAND_OUTPUT_BYTES) {
            outStr =
              outStr.slice(0, DEFAULT_MAX_COMMAND_OUTPUT_BYTES) +
              "\n[... Stdout truncated to prevent context overflow ...]";
            truncated = true;
          }

          if (errStr.length > DEFAULT_MAX_COMMAND_OUTPUT_BYTES) {
            errStr =
              errStr.slice(0, DEFAULT_MAX_COMMAND_OUTPUT_BYTES) +
              "\n[... Stderr truncated to prevent context overflow ...]";
            truncated = true;
          }

          const exitCode = err ? (err.code !== undefined && typeof err.code === "number" ? err.code : 1) : 0;
          const isSuccess = exitCode === 0 && !isTimedOut;

          const formattedOutput = [
            `Exit code: ${exitCode}`,
            isTimedOut ? `Status: TIMED OUT (exceeded ${timeoutMs}ms)` : `Status: ${isSuccess ? "SUCCESS" : "FAILED"}`,
            outStr.trim() ? `\n--- Stdout ---\n${outStr.trim()}` : "",
            errStr.trim() ? `\n--- Stderr ---\n${errStr.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          if (isTimedOut) {
            resolve({
              success: false,
              output: formattedOutput,
              error: `Command timed out after ${timeoutMs}ms`,
            });
            return;
          }

          if (!isSuccess) {
            resolve({
              success: false,
              output: formattedOutput,
              error: `Command exited with non-zero exit code: ${exitCode}`,
            });
            return;
          }

          resolve({
            success: true,
            output: formattedOutput,
          });
        },
      );
    });
  }
}
