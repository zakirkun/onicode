/**
 * Built-in `Read` tool.
 *
 * Reads a UTF-8 text file and returns its contents, optionally sliced by
 * line range. Designed to mirror Claude Code's Read tool surface so that
 * agents written for one are immediately usable in the other.
 *
 * The tool is non-destructive — it only reads. Permission rules can
 * therefore default to `allow` for the Read tool in most setups.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { ToolValidationError } from "../../core/tools/errors.js";
import type { Tool, ToolExecCtx } from "../../core/tools/types.js";
import { resolveAgainst } from "../../utils/pathUtils.js";

/** Maximum number of lines returned in a single call. */
const DEFAULT_LIMIT = 2000;

/** Input schema. */
const ReadInputSchema = z
  .object({
    /** Absolute or cwd-relative path to the file. */
    path: z.string().min(1),
    /** 1-based line number to start reading from. */
    offset: z.number().int().nonnegative().optional(),
    /** Maximum number of lines to return. */
    limit: z.number().int().positive().max(10_000).optional(),
  })
  .strict();

/** Inferred input type. */
export type ReadInput = z.infer<typeof ReadInputSchema>;

/** Output shape returned to the LLM. */
export interface ReadOutput {
  path: string;
  content: string;
  totalLines: number;
  truncated: boolean;
}

/** The `Read` tool definition. */
export const readTool: Tool<ReadInput, ReadOutput> = {
  name: "Read",
  description:
    "Read a UTF-8 text file from the filesystem. Optional `offset` and `limit` slice the file by line number; both are 1-based. Returns the requested lines verbatim plus the file's total line count.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", description: "Absolute or cwd-relative file path." },
      offset: { type: "integer", minimum: 0, description: "1-based starting line." },
      limit: { type: "integer", minimum: 1, maximum: 10_000, description: "Maximum lines." },
    },
  },
  destructive: false,
  source: "builtin",

  summarize(input: ReadInput): string {
    const { path, offset, limit } = input;
    const range = offset || limit ? ` lines ${offset ?? 1}+${limit ?? DEFAULT_LIMIT}` : "";
    return `Read ${path}${range}`;
  },

  async execute(input: ReadInput, ctx: ToolExecCtx): Promise<ReadOutput> {
    const parsed = parseInput(input);
    const absolute = resolveAgainst(ctx.cwd, parsed.path);
    const raw = await readFile(absolute, "utf8");
    const lines = raw.split(/\r?\n/);
    const offset = parsed.offset ?? 1;
    const limit = parsed.limit ?? DEFAULT_LIMIT;
    const start = Math.max(0, offset - 1);
    const end = Math.min(lines.length, start + limit);
    const slice = lines.slice(start, end);
    return {
      path: absolute,
      content: slice.join("\n"),
      totalLines: lines.length,
      truncated: end < lines.length,
    };
  },
};

/** Validate input via zod and surface a `ToolValidationError` on failure. */
function parseInput(input: unknown): ReadInput {
  const result = ReadInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError("Invalid Read input", result.error.issues);
  }
  return result.data;
}
