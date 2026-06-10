/**
 * TUI-local view types.
 *
 * The TUI keeps its own typed view of the conversation rather than rendering
 * raw `AgentEvent`s, because:
 *
 *   - Streaming `text_delta` chunks should coalesce into a single message
 *     bubble until the turn ends.
 *   - Tool calls and results should appear as their own line items, even
 *     interleaved with assistant text.
 *   - Slash commands are local-only — the agent never sees them — so they
 *     need their own message kind for display.
 *
 * `ChatMessageView` is a tagged union; `MessageList` switches on `kind` and
 * renders the appropriate component.
 */
import type { ToolCall, ToolErrorPayload } from "../core/tools/types.js";

/** A single rendered line in the scroll-back area. */
export type ChatMessageView =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; streaming: boolean }
  | { id: string; kind: "tool_call"; call: ToolCall; summary: string }
  | {
      id: string;
      kind: "tool_result";
      callId: string;
      ok: boolean;
      preview: string;
      error?: ToolErrorPayload;
    }
  | { id: string; kind: "system"; text: string }
  | { id: string; kind: "error"; text: string };

/** Activity state surfaced in the status bar. */
export type AgentActivity =
  | { kind: "idle" }
  | { kind: "thinking" }
  | { kind: "running_tool"; toolName: string; summary: string }
  | { kind: "awaiting_permission"; toolName: string; summary: string };

/**
 * Pending permission prompt awaiting user input. The TUI binds `resolve` to
 * key handlers: `y` → `"allow"`, `n` → `"deny"`, `a` → `"allow_always"`.
 */
export interface PendingPermission {
  id: string;
  toolName: string;
  inputSummary: string;
  preview: string;
  resolve: (outcome: PermissionPromptOutcome) => void;
}

/** Outcomes a TUI permission prompt may produce. */
export type PermissionPromptOutcome = "allow" | "deny" | "allow_always";
