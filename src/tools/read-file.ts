/**
 * Read File Tool
 *
 * Reads file contents inside the workspace with bounded line ranges and truncation guards.
 */

import fs from "fs/promises";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.js";
import type { ToolDefinition } from "../llm/types.js";
import { SafetyPolicy } from "../safety/policy.js";

export const ReadFileInputSchema = z.object({
  path: z.string().min(1, "File path cannot be empty"),
  startLine: z.number().int().min(1).optional().default(1),
  endLine: z.number().int().min(1).optional(),
  maxLines: z.number().int().min(1).optional().default(300),
});

export type ReadFileInput = z.infer<typeof ReadFileInputSchema>;

export const DEFAULT_MAX_READ_BYTES = 50 * 1024; // 50 KB cap per read

export class ReadFileTool implements Tool<ReadFileInput> {
  readonly name = "read_file";
  readonly description =
    "Read the contents of a file within the workspace. Supports specifying startLine and endLine (1-indexed). Output is bounded with line numbers and truncation notices.";
  readonly inputSchema = ReadFileInputSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative or workspace-local path to the file to read.",
          },
          startLine: {
            type: "number",
            description: "Optional 1-indexed line number to start reading from (default: 1).",
          },
          endLine: {
            type: "number",
            description: "Optional 1-indexed line number to stop reading at (inclusive).",
          },
          maxLines: {
            type: "number",
            description: "Optional maximum number of lines to return (default: 300).",
          },
        },
        required: ["path"],
      },
    };
  }

  async execute(input: ReadFileInput, context: ToolContext) {
    // 1. Enforce workspace safety boundary
    const validation = SafetyPolicy.validateWorkspacePath(context.workspaceRoot, input.path);
    if (!validation.allowed) {
      return {
        success: false,
        output: "",
        error: validation.reason || "Path is outside the allowed workspace directory",
      };
    }

    const filePath = validation.resolvedPath;

    try {
      // 2. Check if path exists and is a file
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        return {
          success: false,
          output: "",
          error: `Path '${input.path}' is a directory, not a file.`,
        };
      }

      // 3. Read raw file contents
      const rawContent = await fs.readFile(filePath, "utf-8");
      const allLines = rawContent.split(/\r?\n/);
      const totalLines = allLines.length;

      const startLine = Math.max(1, input.startLine || 1);
      const requestedEnd = input.endLine ? Math.min(input.endLine, totalLines) : totalLines;

      if (startLine > totalLines) {
        return {
          success: true,
          output: `[File has ${totalLines} total lines; startLine ${startLine} is past the end of the file]`,
        };
      }

      // Slice lines (convert from 1-indexed to 0-indexed)
      const maxAllowedLines = input.maxLines || 300;
      const effectiveEnd = Math.min(requestedEnd, startLine + maxAllowedLines - 1);
      const selectedLines = allLines.slice(startLine - 1, effectiveEnd);

      let formattedOutput = selectedLines
        .map((line, idx) => `${startLine + idx}: ${line}`)
        .join("\n");

      // Check for line or byte truncation
      const isLineTruncated = effectiveEnd < requestedEnd || effectiveEnd < totalLines;
      const isByteTruncated = formattedOutput.length > DEFAULT_MAX_READ_BYTES;

      if (isByteTruncated) {
        formattedOutput = formattedOutput.slice(0, DEFAULT_MAX_READ_BYTES);
      }

      if (isLineTruncated || isByteTruncated) {
        formattedOutput += `\n\n[... Truncated: showing lines ${startLine}-${effectiveEnd} of ${totalLines} total lines ...]`;
      }

      return {
        success: true,
        output: formattedOutput,
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return {
          success: false,
          output: "",
          error: `File not found: '${input.path}'`,
        };
      }
      return {
        success: false,
        output: "",
        error: `Failed to read file '${input.path}': ${error.message || String(err)}`,
      };
    }
  }
}
