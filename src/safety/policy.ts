/**
 * Safety & Security Policy Enforcement
 *
 * Enforces workspace isolation (NFR-2), path sandboxing, and command policy rules.
 */

import path from "path";

export interface WorkspaceValidationResult {
  allowed: boolean;
  resolvedPath: string;
  reason?: string;
}

export class SafetyPolicy {
  /**
   * Validates that targetPath is contained within workspaceRoot.
   * Prevents directory traversal and access to system files outside the project.
   */
  static validateWorkspacePath(
    workspaceRoot: string,
    targetPath: string,
  ): WorkspaceValidationResult {
    if (!targetPath || typeof targetPath !== "string") {
      return {
        allowed: false,
        resolvedPath: "",
        reason: "Path must be a non-empty string",
      };
    }

    const resolvedRoot = path.resolve(workspaceRoot);
    const resolvedTarget = path.isAbsolute(targetPath)
      ? path.resolve(targetPath)
      : path.resolve(resolvedRoot, targetPath);

    // Normalize casing for Windows compatibility while comparing paths
    const isWindows = process.platform === "win32";
    const compRoot = isWindows ? resolvedRoot.toLowerCase() : resolvedRoot;
    const compTarget = isWindows ? resolvedTarget.toLowerCase() : resolvedTarget;

    // Check if resolvedTarget is equal to compRoot or is a subdirectory of compRoot
    const relative = path.relative(compRoot, compTarget);
    const isInside =
      !relative.startsWith("..") && !path.isAbsolute(relative);

    if (!isInside) {
      return {
        allowed: false,
        resolvedPath: resolvedTarget,
        reason: `Access denied: Target path '${targetPath}' resolves outside workspace root '${workspaceRoot}'`,
      };
    }

    return {
      allowed: true,
      resolvedPath: resolvedTarget,
    };
  }

  /**
   * Safe command prefix allowlist for automated coding agent runs.
   * Denies arbitrary destructive, network, or unverified system commands.
   */
  private static readonly ALLOWED_COMMAND_PATTERNS: RegExp[] = [
    /^npm\s+(test|run\s+[\w:-]+|exec\s+[\w:-]+)(\s+.*)?$/i,
    /^npx\s+[\w@/:-]+(\s+.*)?$/i,
    /^node\s+[\w./\\:-]+(\s+.*)?$/i,
    /^git\s+(status|diff|log|show|branch|rev-parse)(\s+.*)?$/i,
    /^vitest(\s+.*)?$/i,
    /^tsc(\s+.*)?$/i,
  ];

  /**
   * Disallowed dangerous commands/patterns that should never run automatically.
   */
  private static readonly BLOCKED_PATTERNS: RegExp[] = [
    /\brm\s+-rf\b/i,
    /\bdel\s+\/[sS]\b/i,
    /\bformat\b/i,
    /\bshutdown\b/i,
    /\bcurl\b/i,
    /\bwget\b/i,
    /\b(mkfs|dd\s+if=)\b/i,
    /[;&|`$]\s*(rm|del|shutdown|curl|wget)\b/i,
  ];

  /**
   * Validates shell command against safe allowlist.
   * Returns DENY for disallowed or unrecognized commands.
   */
  static validateCommand(command: string): { allowed: boolean; reason?: string } {
    if (!command || typeof command !== "string" || !command.trim()) {
      return {
        allowed: false,
        reason: "Command cannot be empty",
      };
    }

    const trimmed = command.trim();

    // Check blocked dangerous patterns first
    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          reason: `Command safety DENY: Command '${command}' matches blocked pattern '${pattern}'`,
        };
      }
    }

    // Check allowlist
    const isAllowed = this.ALLOWED_COMMAND_PATTERNS.some((pattern) =>
      pattern.test(trimmed),
    );

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Command safety DENY: Command '${command}' is not in the safe allowlist. Allowed prefixes: npm test, npm run <script>, npx <bin>, node <script>, git status/diff/log.`,
      };
    }

    return { allowed: true };
  }
}
