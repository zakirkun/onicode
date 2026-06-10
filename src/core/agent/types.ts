/**
 * Agent loop types.
 *
 * An "agent" in OniCode is a single LLM context window with a fixed
 * system prompt, tool registry, and provider. The coordinator may spawn
 * many agents — a top-level one plus zero or more sub-agents — each with
 * its own `Agent` instance and its own message history.
 *
 * The agent's public surface:
 *
 *   - Construct with `AgentConfig`.
 *   - Send a user turn via `agent.send(text)`; receive an `AsyncIterable<AgentEvent>`.
 *   - Inspect the final outcome via the `done` event payload (`AgentResult`).
 *
 * `AgentEvent` is the streaming surface consumed by the TUI and the
 * coordinator. It mirrors `ChatChunk` but adds tool-result events and
 * agent-lifecycle markers that downstream components need.
 */
import type { ToolCall, ToolResult } from "../tools/types.js";
import type { ChatMessage, StopReason, TokenUsage } from "../../providers/types.js";

/** Configuration for an `Agent` instance. */
export interface AgentConfig {
  /** Unique id of this agent. */
  id: string;
  /** Provider model id. */
  model: string;
  /** Provider id (just metadata; the provider object itself is supplied separately). */
  providerId: string;
  /** System prompt prepended to every turn. */
  systemPrompt: string;
  /** Optional sampling temperature. */
  temperature?: number;
  /** Optional output token cap per turn. */
  maxOutputTokens?: number;
  /**
   * Maximum number of provider round-trips per `send()`. Each tool call
   * and its follow-up generation count as one extra trip. Default: 16.
   */
  maxTurns?: number;
}

/** Final outcome of a `send()` call. */
export interface AgentResult {
  /** Agent that produced the result. */
  agentId: string;
  /** Concatenated text emitted by the assistant on the final turn. */
  finalText: string;
  /** All tool calls made during the run, in order. */
  toolCalls: ToolCall[];
  /** Aggregated token usage across all provider round-trips. */
  usage: TokenUsage;
  /** Stop reason of the last provider response. */
  stopReason: StopReason;
}

/**
 * Streaming event surface.
 *
 * The TUI subscribes to these to render assistant text, show tool-call
 * status, and update the agent panel. The coordinator subscribes to
 * propagate them upward into the parent agent's transcript.
 */
export type AgentEvent =
  | { kind: "turn_start"; agentId: string; turnIndex: number }
  | { kind: "text_delta"; agentId: string; delta: string }
  | { kind: "tool_call"; agentId: string; call: ToolCall }
  | { kind: "tool_result"; agentId: string; result: ToolResult }
  | { kind: "turn_end"; agentId: string; turnIndex: number; usage: TokenUsage }
  | { kind: "done"; agentId: string; result: AgentResult }
  | { kind: "error"; agentId: string; error: { message: string; details?: unknown } };

/**
 * Snapshot of an agent's message history. The agent owns the canonical
 * copy; this type exists so the coordinator can inspect or seed it
 * (e.g. to inject a parent's summary into a freshly-spawned sub-agent).
 */
export interface AgentMessages {
  messages: ChatMessage[];
}
