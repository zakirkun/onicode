/**
 * Core tool types.
 *
 * Tools are the single mechanism by which an agent affects the world. The
 * agent loop receives a stream of `ToolCall` events from the LLM, and the
 * executor turns each into a `ToolResult`. The provider layer maps tool
 * definitions into provider-specific tool-use schemas via `ToolManifest`.
 *
 * Design rules:
 * - A tool is a plain object plus a function — not a class. This keeps
 *   tools trivially composable (we can wrap them with retries, logging,
 *   timeouts) without inheritance gymnastics.
 * - The `destructive` flag is the gate's input for mode-based policy.
 *   Tools that mutate disk, run shell commands, or send network requests
 *   are destructive; pure read-only inspection is not.
 * - `summarize(input)` produces the human-readable string that the
 *   permission system, the TUI status bar, and the JSONL session log all
 *   consume. Tools own this serialization because only the tool knows
 *   which fields are interesting.
 */
import type { Logger } from "../../utils/logger.js";

/**
 * Loose JSON Schema type. We do not bind to a specific JSON-Schema library
 * because the schemas are produced from zod (`z.toJSONSchema`) and consumed
 * by provider SDKs that already accept the standard Draft-07 shape.
 */
export type JSONSchema = Record<string, unknown>;

/** Whether a tool is built-in to OniCode or imported from an MCP server. */
export type ToolSource = "builtin" | "mcp";

/**
 * Manifest describing a tool to the LLM and to other components that do not
 * need to invoke it. This is the public face of a tool.
 */
export interface ToolManifest {
  /** Stable, unique tool name. */
  name: string;
  /** Human-readable one-paragraph description, surfaced verbatim to the LLM. */
  description: string;
  /** JSON Schema for the tool's input arguments. */
  inputSchema: JSONSchema;
  /** Where this tool came from — drives namespacing in MCP-merged registries. */
  source: ToolSource;
}

/**
 * Per-call execution context. The executor builds one of these for every
 * tool invocation. Tools receive this object as their second argument and
 * must respect `signal` for cancellation.
 */
export interface ToolExecCtx {
  /** Cancellation signal. Tools should observe and abort long-running work. */
  signal: AbortSignal;
  /** Process working directory at the time of the call. */
  cwd: string;
  /** Pre-tagged child logger (`{tool, callId, agentId}`). */
  log: Logger;
  /** Identifier of the agent making the call (top-level or sub-agent). */
  agentId: string;
  /** Unique id for this tool call (matches the `id` of the originating ToolCall). */
  callId: string;
}

/**
 * A pending tool call as emitted by the LLM. The executor matches `name`
 * against the registry and validates `input` against the registered tool's
 * `inputSchema` before running it.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Result of a tool call. `ok=true` means the tool completed successfully and
 * `output` is its return value; `ok=false` means execution failed and
 * `error` carries a user-facing message. Permission denials are reported
 * via `ok=false` with `error.kind="permission"`.
 */
export type ToolResult =
  | { callId: string; ok: true; output: unknown }
  | { callId: string; ok: false; error: ToolErrorPayload };

/** Structured error payload returned by failed tool calls. */
export interface ToolErrorPayload {
  /** Coarse error category for filtering and metrics. */
  kind: "validation" | "permission" | "execution" | "aborted";
  /** Human-readable error message; safe to render in TUI. */
  message: string;
  /** Optional structured details (e.g. zod issues). */
  details?: unknown;
}

/**
 * A registered tool definition.
 *
 * The `I` type parameter is the validated input shape (post-schema), and
 * `O` is the return type. Tools are typically defined via a helper that
 * derives `inputSchema` from a zod schema and binds `I` to its inferred type.
 */
export interface Tool<I = unknown, O = unknown> {
  /** Stable, unique name. Used for registration, permission rules, and LLM dispatch. */
  readonly name: string;
  /** One-paragraph description. */
  readonly description: string;
  /** JSON Schema of the input. */
  readonly inputSchema: JSONSchema;
  /** Whether the tool can mutate state. Drives mode-based permission policy. */
  readonly destructive: boolean;
  /** Source of the tool — `builtin` or `mcp`. */
  readonly source: ToolSource;
  /**
   * Produce a short, human-readable summary of the input. Used by the
   * permission gate and the TUI status bar. Should be a single line.
   */
  summarize(input: I): string;
  /** Run the tool. May throw or return; the executor catches both. */
  execute(input: I, ctx: ToolExecCtx): Promise<O>;
}
