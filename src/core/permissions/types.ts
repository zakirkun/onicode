/**
 * Permission system types.
 *
 * The permission gate is invoked once per tool call. Its job is purely
 * decision-making: given the active mode, the configured allow / deny
 * rules, and a summary of the proposed call, return an `allow`, `deny`,
 * or `prompt` decision. Side effects (actually prompting the user, actually
 * blocking execution) live in the executor and the TUI.
 */
import type { PermissionMode } from "../../config/types.js";

export type { PermissionMode };

/**
 * A permission rule pattern.
 *
 * Format: `ToolName(input-pattern)`.
 *
 * - `ToolName` matches the registered tool name exactly. The wildcard `*`
 *   matches every tool.
 * - `input-pattern` is a glob (default) or, when prefixed with `re:`, a
 *   regex matched against a tool-specific summary string. For file tools
 *   the summary is the absolute path; for `Bash` it is the full command.
 *
 * Examples:
 *   - `Read(**)`              — allow Read for any path.
 *   - `Bash(npm test)`        — allow this exact command.
 *   - `Write(/etc/**)`        — match (typically used in deny lists).
 *   - `Bash(re:^git\\s.*)`    — match any git command via regex.
 *   - `*(re:.*secret.*)`      — match any tool whose input mentions "secret".
 */
export type PermissionRule = string;

/**
 * Decision returned by the gate.
 *
 * The TUI renders the `preview` field of a `prompt` decision verbatim, so
 * callers should make the preview human-readable (one or two short lines).
 */
export type PermissionDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "prompt"; preview: string };

/**
 * Information about a tool call that the gate needs in order to decide.
 *
 * The executor builds this object from the registered tool definition and
 * the actual input value the agent supplied. The summary is the string the
 * permission rules will match against.
 */
export interface PermissionCheckInput {
  /** Registered tool name (e.g. "Read", "Bash", "Write"). */
  toolName: string;
  /** Tool-specific summary (file path, full bash command, etc.) used for matching. */
  inputSummary: string;
  /** Whether the tool can mutate disk / external state. Drives mode-based policies. */
  destructive: boolean;
}

/**
 * Static policy context: the active mode and the configured rule lists.
 *
 * The gate function takes this once at the start of a session and reuses
 * it across many checks; rebuilding for every call would be wasteful.
 */
export interface PermissionContext {
  mode: PermissionMode;
  allow: readonly PermissionRule[];
  deny: readonly PermissionRule[];
}
