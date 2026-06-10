/**
 * Built-in `Grep` tool.
 *
 * Searches the contents of files for a regex pattern. Implementation uses
 * `fast-glob` to enumerate candidate files plus a per-line `RegExp.test`
 * scan; this avoids requiring `ripgrep` to be installed and keeps the
 * tool fully cross-platform.
 *
 * Results are capped at `MAX_RESULTS` and the response signals truncation.
 * Non-destructive — read-only.
 */
import { readFile } from "node:fs/promises";
import fastGlob from "fast-glob";
import { z } from "zod";

import { ToolExecutionError, ToolValidationError } from "../../core/tools/errors.js";
import { resolveAgainst } from "../../utils/pathUtils.js";
import type { Tool, ToolExecCtx } from "../../core/tools/types.js";

/** Maximum number of match lines returned per call. */
const MAX_RESULTS = 250;

/** Input schema. */
const GrepInputSchema = z
  .object({
    /** Regex pattern (JS flavor). */
    pattern: z.string().min(1),
    /** Directory to search; defaults to the agent's cwd. */
    path: z.string().optional(),
    /** Glob pattern restricting which files to scan. Defaults to `**\/*`. */
    glob: z.string().optional(),
    /** Case-insensitive match. */
    caseInsensitive: z.boolean().optional(),
    /** Lines of context before AND after each match. */
    contextLines: z.number().int().nonnegative().max(20).optional(),
  })
  .strict();

/** Inferred input type. */
export type GrepInput = z.infer<typeof GrepInputSchema>;

/** A single match record. */
export interface GrepMatch {
  /** Absolute file path. */
  path: string;
  /** 1-based line number of the match. */
  line: number;
  /** Matched line content (with optional context lines joined by newlines). */
  preview: string;
}

/** Output shape returned to the LLM. */
export interface GrepOutput {
  matches: GrepMatch[];
  filesScanned: number;
  truncated: boolean;
}

/** The `Grep` tool definition. */
export const grepTool: Tool<GrepInput, GrepOutput> = {
  name: "Grep",
  description:
    "Search file contents for a regex pattern. Returns matching lines with file path and line number. Up to 250 matches per call.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["pattern"],
    properties: {
      pattern: { type: "string", description: "Regex (JS flavor)." },
      path: { type: "string", description: "Directory to search; defaults to cwd." },
      glob: { type: "string", description: "Glob filter for which files to scan." },
      caseInsensitive: { type: "boolean", default: false },
      contextLines: { type: "integer", minimum: 0, maximum: 20, default: 0 },
    },
  },
  destructive: false,
  source: "builtin",

  summarize(input: GrepInput): string {
    return `Grep ${input.pattern}${input.glob ? ` in ${input.glob}` : ""}`;
  },

  async execute(input: GrepInput, ctx: ToolExecCtx): Promise<GrepOutput> {
    const parsed = parseInput(input);
    const cwd = parsed.path ? resolveAgainst(ctx.cwd, parsed.path) : ctx.cwd;
    const regex = compileRegex(parsed.pattern, parsed.caseInsensitive ?? false);
    const contextLines = parsed.contextLines ?? 0;

    const candidates = await fastGlob(parsed.glob ?? "**/*", {
      cwd,
      absolute: true,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    });

    const matches: GrepMatch[] = [];
    for (const filePath of candidates) {
      if (matches.length >= MAX_RESULTS) {
        break;
      }
      let content: string;
      try {
        content = await readFile(filePath, "utf8");
      } catch {
        continue; // Likely binary or permission error — skip silently.
      }
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= MAX_RESULTS) {
          break;
        }
        const line = lines[i] ?? "";
        if (regex.test(line)) {
          const start = Math.max(0, i - contextLines);
          const end = Math.min(lines.length, i + contextLines + 1);
          const preview = lines.slice(start, end).join("\n");
          matches.push({ path: filePath, line: i + 1, preview });
        }
      }
    }

    return {
      matches,
      filesScanned: candidates.length,
      truncated: matches.length >= MAX_RESULTS,
    };
  },
};

/** Validate input via zod. */
function parseInput(input: unknown): GrepInput {
  const result = GrepInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError("Invalid Grep input", result.error.issues);
  }
  return result.data;
}

/** Compile the user's regex; surface compile errors as ToolExecutionError. */
function compileRegex(pattern: string, caseInsensitive: boolean): RegExp {
  try {
    return new RegExp(pattern, caseInsensitive ? "i" : "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : "invalid regex";
    throw new ToolExecutionError(`Invalid regex: ${msg}`);
  }
}
