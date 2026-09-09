/**
 * File Search Tool
 *
 * Implements a pure Node.js recursive directory walker for substring/regex matching
 * within workspace boundaries, with strict output bounds and truncation guards.
 */

import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.js";
import type { ToolDefinition } from "../llm/types.js";
import { SafetyPolicy } from "../safety/policy.js";

export const SearchInputSchema = z.object({
  query: z.string().min(1, "Search query cannot be empty"),
  path: z.string().optional().default("."),
  isRegex: z.boolean().optional().default(false),
  caseSensitive: z.boolean().optional().default(false),
  filePattern: z.string().optional(),
  maxResults: z.number().int().min(1).optional().default(50),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

export const DEFAULT_MAX_SEARCH_BYTES = 40 * 1024; // 40 KB cap

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".genesis",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
]);

export class SearchTool implements Tool<SearchInput> {
  readonly name = "search_files";
  readonly description =
    "Search for files or code occurrences in the workspace using substring or regex matching. Returns matching file paths, line numbers, and snippets.";
  readonly inputSchema = SearchInputSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The text string or regex pattern to search for in files.",
          },
          path: {
            type: "string",
            description: "Optional relative sub-directory path to limit search scope (default: '.').",
          },
          isRegex: {
            type: "boolean",
            description: "Whether query should be evaluated as a regular expression (default: false).",
          },
          caseSensitive: {
            type: "boolean",
            description: "Whether search should be case sensitive (default: false).",
          },
          filePattern: {
            type: "string",
            description: "Optional filename filter (e.g. '.ts', 'package.json').",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of matching lines to return (default: 50).",
          },
        },
        required: ["query"],
      },
    };
  }

  async execute(input: SearchInput, context: ToolContext) {
    // 1. Enforce workspace safety boundary
    const targetDir = input.path || ".";
    const validation = SafetyPolicy.validateWorkspacePath(context.workspaceRoot, targetDir);
    if (!validation.allowed) {
      return {
        success: false,
        output: "",
        error: validation.reason || "Search path is outside the allowed workspace directory",
      };
    }

    const searchRoot = validation.resolvedPath;

    // 2. Prepare matcher regex
    let matcher: RegExp;
    try {
      const flags = input.caseSensitive ? "g" : "gi";
      if (input.isRegex) {
        matcher = new RegExp(input.query, flags);
      } else {
        const escaped = input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        matcher = new RegExp(escaped, flags);
      }
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        error: `Invalid regex pattern '${input.query}': ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 3. Walk directory and collect matches
    const maxResults = input.maxResults || 50;
    const matches: string[] = [];
    let truncated = false;

    try {
      await this.walkAndSearch(
        searchRoot,
        context.workspaceRoot,
        matcher,
        input.filePattern,
        matches,
        maxResults,
      );
    } catch (err: unknown) {
      return {
        success: false,
        output: "",
        error: `Search error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (matches.length >= maxResults) {
      truncated = true;
    }

    if (matches.length === 0) {
      return {
        success: true,
        output: `No matches found for '${input.query}' in '${targetDir}'`,
      };
    }

    let output = matches.join("\n");
    if (output.length > DEFAULT_MAX_SEARCH_BYTES) {
      output = output.slice(0, DEFAULT_MAX_SEARCH_BYTES);
      truncated = true;
    }

    if (truncated) {
      output += `\n\n[... Truncated: showing first ${matches.length} matching occurrences ...]`;
    }

    return {
      success: true,
      output,
    };
  }

  private async walkAndSearch(
    currentDir: string,
    workspaceRoot: string,
    matcher: RegExp,
    filePattern: string | undefined,
    matches: string[],
    maxResults: number,
  ): Promise<void> {
    if (matches.length >= maxResults) return;

    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      if (matches.length >= maxResults) break;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        await this.walkAndSearch(
          fullPath,
          workspaceRoot,
          matcher,
          filePattern,
          matches,
          maxResults,
        );
      } else if (entry.isFile()) {
        if (filePattern && !entry.name.includes(filePattern)) {
          continue;
        }

        await this.searchInFile(fullPath, workspaceRoot, matcher, matches, maxResults);
      }
    }
  }

  private async searchInFile(
    filePath: string,
    workspaceRoot: string,
    matcher: RegExp,
    matches: string[],
    maxResults: number,
  ): Promise<void> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      // Check if file seems binary (contains null bytes)
      if (content.includes("\0")) {
        return;
      }

      const relPath = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
      const lines = content.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxResults) break;
        const line = lines[i];

        // Reset regex state for global regex
        matcher.lastIndex = 0;
        if (matcher.test(line)) {
          const trimmed = line.trim();
          const truncatedLine = trimmed.length > 200 ? trimmed.slice(0, 200) + "..." : trimmed;
          matches.push(`${relPath}:${i + 1}: ${truncatedLine}`);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
}
