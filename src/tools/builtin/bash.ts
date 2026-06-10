/**
 * Built-in `Bash` tool.
 *
 * Runs a shell command via `execa` and returns stdout/stderr. Output is
 * truncated to a fixed cap so a runaway command does not blow the LLM
 * context budget; the truncation is signaled in the response so the
 * agent can request narrower output if needed.
 *
 * On Windows the shell is `cmd.exe`; everywhere else `/bin/sh`. The tool
 * is marked `destructive` because shell commands can mutate disk and
 * state arbitrarily.
 *
 * Cancellation via `ToolExecCtx.signal` propagates a SIGTERM to the child;
 * a hard timeout falls back to SIGKILL.
 */
import { execa } from "execa";
import { z } from "zod";

import { ToolAbortedError, ToolValidationError } from "../../core/tools/errors.js";
import type { Tool, ToolExecCtx } from "../../core/tools/types.js";

/** Default per-command timeout. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Hard cap on captured stdout/stderr in characters. */
const OUTPUT_CHAR_LIMIT = 30_000;

/** Input schema. */
const BashInputSchema = z
  .object({
    /** Shell command. Passed through `sh -c` or `cmd.exe /c`. */
    command: z.string().min(1),
    /** Override command timeout in milliseconds. */
    timeout: z.number().int().positive().max(600_000).optional(),
    /** Override working directory. Resolved against the agent's cwd. */
    cwd: z.string().optional(),
  })
  .strict();

/** Inferred input type. */
export type BashInput = z.infer<typeof BashInputSchema>;

/** Output shape returned to the LLM. */
export interface BashOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  /** True when stdout/stderr was truncated to fit `OUTPUT_CHAR_LIMIT`. */
  truncated: boolean;
}

/** Whether to use the Windows shell. */
const IS_WINDOWS = process.platform === "win32";

/** The `Bash` tool definition. */
export const bashTool: Tool<BashInput, BashOutput> = {
  name: "Bash",
  description:
    "Run a shell command. Captures stdout, stderr, and exit code. Output is truncated past a fixed limit; if you need more, narrow the command.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: { type: "string", description: "Shell command to execute." },
      timeout: {
        type: "integer",
        minimum: 1,
        maximum: 600_000,
        description: "Override command timeout in milliseconds.",
      },
      cwd: {
        type: "string",
        description: "Override working directory; resolved against the agent's cwd.",
      },
    },
  },
  destructive: true,
  source: "builtin",

  summarize(input: BashInput): string {
    const truncatedCmd =
      input.command.length > 80 ? `${input.command.slice(0, 77)}...` : input.command;
    return `Bash ${truncatedCmd}`;
  },

  async execute(input: BashInput, ctx: ToolExecCtx): Promise<BashOutput> {
    const parsed = parseInput(input);
    const timeout = parsed.timeout ?? DEFAULT_TIMEOUT_MS;
    const start = Date.now();

    const exec = IS_WINDOWS
      ? execa("cmd.exe", ["/c", parsed.command], {
          cwd: parsed.cwd ?? ctx.cwd,
          timeout,
          reject: false,
          all: false,
          encoding: "utf8",
        })
      : execa("/bin/sh", ["-c", parsed.command], {
          cwd: parsed.cwd ?? ctx.cwd,
          timeout,
          reject: false,
          all: false,
          encoding: "utf8",
        });

    const onAbort = (): void => {
      exec.kill("SIGTERM");
      // Escalate after grace period.
      setTimeout(() => {
        if (!exec.killed) {
          exec.kill("SIGKILL");
        }
      }, 2000);
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    try {
      const result = await exec;
      const stdout = truncate(result.stdout?.toString() ?? "");
      const stderr = truncate(result.stderr?.toString() ?? "");
      return {
        stdout: stdout.text,
        stderr: stderr.text,
        exitCode: result.exitCode ?? null,
        durationMs: Date.now() - start,
        truncated: stdout.truncated || stderr.truncated,
      };
    } catch (err: unknown) {
      if (ctx.signal.aborted) {
        throw new ToolAbortedError("Bash command aborted.");
      }
      throw err;
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }
  },
};

/** Validate input via zod. */
function parseInput(input: unknown): BashInput {
  const result = BashInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError("Invalid Bash input", result.error.issues);
  }
  return result.data;
}

/** Truncate a string to `OUTPUT_CHAR_LIMIT`, signaling whether truncation occurred. */
function truncate(s: string): { text: string; truncated: boolean } {
  if (s.length <= OUTPUT_CHAR_LIMIT) {
    return { text: s, truncated: false };
  }
  return {
    text: `${s.slice(0, OUTPUT_CHAR_LIMIT)}\n... [truncated ${s.length - OUTPUT_CHAR_LIMIT} chars]`,
    truncated: true,
  };
}
