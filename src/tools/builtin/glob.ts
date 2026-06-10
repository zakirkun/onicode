/**
 * Built-in `Glob` tool.
 *
 * Finds files matching a glob pattern. Wraps `fast-glob` and applies the
 * conventions OniCode uses for read-only file inspection:
 *
 *   - Patterns are interpreted relative to `path` (or `ctx.cwd` if absent).
 *   - Results are sorted by modification time, newest first — agents most
 *     often want recently-touched files at the top.
 *   - Results are capped at `MAX_RESULTS`; the response signals truncation
 *     so the agent can narrow the pattern if needed.
 *
 * Non-destructive — read-only filesystem inspection.
 */
import { stat } from "node:fs/promises";
import fastGlob from "fast-glob";
import { z } from "zod";

import { ToolValidationError } from "../../core/tools/errors.js";
import { resolveAgainst } from "../../utils/pathUtils.js";
import type { Tool, ToolExecCtx } from "../../core/tools/types.js";

/** Maximum number of paths returned per call. */
const MAX_RESULTS = 250;

/** Input schema. */
const GlobInputSchema = z
  .object({
    /** Glob pattern, e.g. `**\/*.ts` or `src/**\/*.{ts,tsx}`. */
    pattern: z.string().min(1),
    /** Directory to search. Defaults to the agent's cwd. */
    path: z.string().optional(),
  })
  .strict();

/** Inferred input type. */
export type GlobInput = z.infer<typeof GlobInputSchema>;

/** Output shape returned to the LLM. */
export interface GlobOutput {
  matches: string[];
  totalFound: number;
  truncated: boolean;
}

/** The `Glob` tool definition. */
export const globTool: Tool<GlobInput, GlobOutput> = {
  name: "Glob",
  description:
    "Find files by glob pattern. Returns absolute paths sorted by modification time, newest first. Up to 250 matches per call.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["pattern"],
    properties: {
      pattern: { type: "string", description: "Glob pattern." },
      path: { type: "string", description: "Directory to search. Defaults to cwd." },
    },
  },
  destructive: false,
  source: "builtin",

  summarize(input: GlobInput): string {
    return input.path ? `Glob ${input.pattern} in ${input.path}` : `Glob ${input.pattern}`;
  },

  async execute(input: GlobInput, ctx: ToolExecCtx): Promise<GlobOutput> {
    const parsed = parseInput(input);
    const cwd = parsed.path ? resolveAgainst(ctx.cwd, parsed.path) : ctx.cwd;
    const matches = await fastGlob(parsed.pattern, {
      cwd,
      absolute: true,
      onlyFiles: true,
      dot: false,
      followSymbolicLinks: false,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
    });

    // Sort by mtime desc; missing stats fall to the bottom.
    const annotated = await Promise.all(
      matches.map(async (path) => {
        try {
          const s = await stat(path);
          return { path, mtimeMs: s.mtimeMs };
        } catch {
          return { path, mtimeMs: 0 };
        }
      }),
    );
    annotated.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const truncated = annotated.length > MAX_RESULTS;
    const sliced = truncated ? annotated.slice(0, MAX_RESULTS) : annotated;
    return {
      matches: sliced.map((m) => m.path),
      totalFound: annotated.length,
      truncated,
    };
  },
};

/** Validate input via zod. */
function parseInput(input: unknown): GlobInput {
  const result = GlobInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError("Invalid Glob input", result.error.issues);
  }
  return result.data;
}
