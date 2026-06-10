/**
 * Built-in `Write` tool.
 *
 * Writes a UTF-8 string to a file, creating parent directories as needed.
 * Overwrites existing files unconditionally — the permission gate (and
 * deny rules like `Write(/etc/**)`) is the safety boundary.
 *
 * Marked `destructive: true` so that mode-based policies treat it as a
 * mutating operation.
 */
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { ToolValidationError } from "../../core/tools/errors.js";
import { ensureDir, resolveAgainst } from "../../utils/pathUtils.js";
import type { Tool, ToolExecCtx } from "../../core/tools/types.js";

/** Input schema. */
const WriteInputSchema = z
  .object({
    /** Absolute or cwd-relative file path. */
    path: z.string().min(1),
    /** UTF-8 contents to write. */
    content: z.string(),
  })
  .strict();

/** Inferred input type. */
export type WriteInput = z.infer<typeof WriteInputSchema>;

/** Output shape returned to the LLM. */
export interface WriteOutput {
  path: string;
  bytesWritten: number;
  /** True when the file did not exist before this write. */
  created: boolean;
}

/** The `Write` tool definition. */
export const writeTool: Tool<WriteInput, WriteOutput> = {
  name: "Write",
  description:
    "Write a UTF-8 string to a file, creating parent directories as needed. Overwrites existing content. For incremental edits prefer `Edit`.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: {
      path: { type: "string", description: "Absolute or cwd-relative file path." },
      content: { type: "string", description: "UTF-8 contents to write." },
    },
  },
  destructive: true,
  source: "builtin",

  summarize(input: WriteInput): string {
    return `Write ${input.path} (${input.content.length} chars)`;
  },

  async execute(input: WriteInput, ctx: ToolExecCtx): Promise<WriteOutput> {
    const parsed = parseInput(input);
    const absolute = resolveAgainst(ctx.cwd, parsed.path);
    const existed = await fileExists(absolute);
    await ensureDir(path.dirname(absolute));
    await writeFile(absolute, parsed.content, "utf8");
    return {
      path: absolute,
      bytesWritten: Buffer.byteLength(parsed.content, "utf8"),
      created: !existed,
    };
  },
};

/** Validate input via zod. */
function parseInput(input: unknown): WriteInput {
  const result = WriteInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError("Invalid Write input", result.error.issues);
  }
  return result.data;
}

/** Check whether a file exists. Treats any stat error as "does not exist". */
async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
