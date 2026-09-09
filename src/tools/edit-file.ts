/**
 * Edit / Write File Tool
 *
 * Supports creating/overwriting files (`write`) and safe, unique single-occurrence
 * text substitution (`replace`) within workspace boundaries.
 */

import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.js";
import type { ToolDefinition } from "../llm/types.js";
import { SafetyPolicy } from "../safety/policy.js";

export const EditFileInputSchema = z.object({
  path: z.string().min(1, "File path cannot be empty"),
  operation: z.enum(["write", "replace"]),
  content: z.string().optional(),
  target: z.string().optional(),
  replacement: z.string().optional(),
});

export type EditFileInput = z.infer<typeof EditFileInputSchema>;

export class EditFileTool implements Tool<EditFileInput> {
  readonly name = "edit_file";
  readonly description =
    "Create, overwrite, or edit a file inside the workspace. Supports 'write' (full file write/overwrite) and 'replace' (exact single-occurrence search and replace).";
  readonly inputSchema = EditFileInputSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative or workspace path of the file to edit or create.",
          },
          operation: {
            type: "string",
            description: "Operation type: 'write' to create/overwrite or 'replace' for text substitution.",
            enum: ["write", "replace"],
          },
          content: {
            type: "string",
            description: "Full file content (required when operation is 'write').",
          },
          target: {
            type: "string",
            description: "Exact text string to find and replace (required when operation is 'replace').",
          },
          replacement: {
            type: "string",
            description: "New text string to replace target with (required when operation is 'replace').",
          },
        },
        required: ["path", "operation"],
      },
    };
  }

  async execute(input: EditFileInput, context: ToolContext) {
    // 1. Enforce workspace safety boundary
    const validation = SafetyPolicy.validateWorkspacePath(context.workspaceRoot, input.path);
    if (!validation.allowed) {
      return {
        success: false,
        output: "",
        error: validation.reason || "Target path is outside the allowed workspace directory",
      };
    }

    const filePath = validation.resolvedPath;

    // 2. Handle 'write' operation (create or overwrite)
    if (input.operation === "write") {
      if (typeof input.content !== "string") {
        return {
          success: false,
          output: "",
          error: "Field 'content' is required when operation is 'write'.",
        };
      }

      try {
        // Ensure parent directories exist
        const parentDir = path.dirname(filePath);
        await fs.mkdir(parentDir, { recursive: true });

        await fs.writeFile(filePath, input.content, "utf-8");
        return {
          success: true,
          output: `Successfully wrote ${Buffer.byteLength(input.content, "utf-8")} bytes to '${input.path}'.`,
        };
      } catch (err: unknown) {
        return {
          success: false,
          output: "",
          error: `Failed to write to '${input.path}': ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // 3. Handle 'replace' operation (search and replace single occurrence)
    if (input.operation === "replace") {
      if (!input.target) {
        return {
          success: false,
          output: "",
          error: "Field 'target' is required and must be non-empty when operation is 'replace'.",
        };
      }

      if (typeof input.replacement !== "string") {
        return {
          success: false,
          output: "",
          error: "Field 'replacement' is required when operation is 'replace'.",
        };
      }

      try {
        const fileContent = await fs.readFile(filePath, "utf-8");

        // Count occurrences of target string
        const occurrences = fileContent.split(input.target).length - 1;

        if (occurrences === 0) {
          return {
            success: false,
            output: "",
            error: `Target text not found in '${input.path}'. Ensure exact matching including whitespace and indentation.`,
          };
        }

        if (occurrences > 1) {
          return {
            success: false,
            output: "",
            error: `Target text found ${occurrences} times in '${input.path}'. Please include more surrounding context to create a unique match.`,
          };
        }

        // Replace the single unique occurrence
        const newContent = fileContent.replace(input.target, input.replacement);
        await fs.writeFile(filePath, newContent, "utf-8");

        return {
          success: true,
          output: `Successfully replaced target text in '${input.path}'.`,
        };
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === "ENOENT") {
          return {
            success: false,
            output: "",
            error: `File not found: '${input.path}'. Cannot perform 'replace' on non-existent file.`,
          };
        }
        return {
          success: false,
          output: "",
          error: `Failed to edit '${input.path}': ${error.message || String(err)}`,
        };
      }
    }

    return {
      success: false,
      output: "",
      error: `Unsupported operation '${input.operation}'. Must be 'write' or 'replace'.`,
    };
  }
}
