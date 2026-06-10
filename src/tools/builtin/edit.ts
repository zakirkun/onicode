/**
 * Built-in `Edit` tool.
 *
 * Performs a literal string replacement in a UTF-8 file. The match must be
 * unique unless `replaceAll: true` is set, mirroring Claude Code's Edit
 * tool semantics. Non-unique matches are surfaced as validation errors so
 * the agent can refine its `oldString` and retry.
 *
 * Atomic: the file is read into memory, modified, and written back in a
 * single `writeFile`. Concurrent edits to the same file are not protected
 * against — that is a higher-level concern.
 */
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

import { ToolExecutionError, ToolValidationError } from "../../core/tools/errors.js";
import { resolveAgainst } from "../../utils/pathUtils.js";
import type { Tool, ToolExecCtx } from "../../core/tools/types.js";

/** Input schema. */
const EditInputSchema = z
  .object({
    /** Path of the file to modify. */
    path: z.string().min(1),
    /** Substring to find. Must match exactly once unless `replaceAll`. */
    oldString: z.string().min(1),
    /** Replacement string. */
    newString: z.string(),
    /** Replace every occurrence instead of requiring uniqueness. */
    replaceAll: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.oldString !== v.newString, {
    message: "`oldString` and `newString` must differ.",
  });

/** Inferred input type. */
export type EditInput = z.infer<typeof EditInputSchema>;

/** Output shape returned to the LLM. */
export interface EditOutput {
  path: string;
  replacements: number;
}

/** The `Edit` tool definition. */
export const editTool: Tool<EditInput, EditOutput> = {
  name: "Edit",
  description:
    "Replace a literal substring in a file. The match must be unique unless `replaceAll` is true. Returns the number of replacements made.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path", "oldString", "newString"],
    properties: {
      path: { type: "string" },
      oldString: { type: "string" },
      newString: { type: "string" },
      replaceAll: { type: "boolean", default: false },
    },
  },
  destructive: true,
  source: "builtin",

  summarize(input: EditInput): string {
    return `Edit ${input.path}${input.replaceAll ? " (replace-all)" : ""}`;
  },

  async execute(input: EditInput, ctx: ToolExecCtx): Promise<EditOutput> {
    const parsed = parseInput(input);
    const absolute = resolveAgainst(ctx.cwd, parsed.path);
    const original = await readFile(absolute, "utf8");

    const occurrences = countOccurrences(original, parsed.oldString);
    if (occurrences === 0) {
      throw new ToolExecutionError(
        `Edit failed: \`oldString\` not found in ${absolute}.`,
      );
    }
    if (occurrences > 1 && !parsed.replaceAll) {
      throw new ToolExecutionError(
        `Edit failed: \`oldString\` is not unique in ${absolute} (${occurrences} matches). ` +
          `Use replaceAll=true or refine the string.`,
      );
    }

    const next = parsed.replaceAll
      ? original.split(parsed.oldString).join(parsed.newString)
      : original.replace(parsed.oldString, parsed.newString);

    await writeFile(absolute, next, "utf8");
    return {
      path: absolute,
      replacements: parsed.replaceAll ? occurrences : 1,
    };
  },
};

/** Validate input via zod. */
function parseInput(input: unknown): EditInput {
  const result = EditInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError("Invalid Edit input", result.error.issues);
  }
  return result.data;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}
