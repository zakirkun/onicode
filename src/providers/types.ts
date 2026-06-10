/**
 * LLM provider abstraction.
 *
 * OniCode talks to providers (Anthropic, OpenAI, Ollama) through a single
 * narrow interface so that the agent loop and the coordinator do not have
 * to know which one is in use. Each adapter in `./<provider>/provider.ts`
 * implements the same `LLMProvider` shape and translates the canonical
 * types here into provider-specific request and response formats.
 *
 * Wire shape:
 *
 *   ChatRequest  → adapter mapper → provider SDK call → SSE / chunks →
 *   adapter mapper → AsyncIterable<ChatChunk> → agent loop.
 *
 * The canonical message representation is content-block based (matching
 * Anthropic's structured content) because it expresses tool use and tool
 * results without lossy round-trips. Adapters that prefer flat string
 * messages (older OpenAI, Ollama) flatten on the way out and reconstruct
 * blocks on the way in.
 */
import type { ToolManifest } from "../core/tools/types.js";

/** Conversation role attached to a message. */
export type Role = "user" | "assistant" | "system" | "tool";

/** A unit of message content. */
export type ChatContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

/** A single message in a chat conversation. */
export interface ChatMessage {
  role: Role;
  content: ChatContentBlock[];
}

/** Token usage reported by the provider for a turn. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from prompt cache (Anthropic). */
  cacheReadTokens?: number;
  /** Tokens written to prompt cache (Anthropic). */
  cacheCreationTokens?: number;
}

/** Why the provider stopped generating. */
export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";

/**
 * Streaming output chunk.
 *
 * The agent loop consumes these as they arrive. Order:
 *   1. Zero or more `text` chunks carrying token deltas.
 *   2. Zero or more `tool_call` chunks with full tool inputs (the adapter
 *      buffers partial tool-use streams and emits one chunk per call).
 *   3. Exactly one `stop` chunk terminating the stream.
 */
export type ChatChunk =
  | { kind: "text"; delta: string }
  | { kind: "tool_call"; id: string; name: string; input: unknown }
  | { kind: "stop"; reason: StopReason; usage: TokenUsage };

/** Request shape sent to a provider. */
export interface ChatRequest {
  /** Provider-specific model id. */
  model: string;
  /** System prompt — pre-pended outside the message list. */
  system?: string;
  /** Conversation history including the new user turn. */
  messages: ChatMessage[];
  /** Tools advertised to the model. */
  tools?: readonly ToolManifest[];
  /** Sampling temperature. */
  temperature?: number;
  /** Maximum output tokens for this turn. */
  maxOutputTokens?: number;
}

/**
 * Provider adapter contract.
 *
 * Implementations are constructed once per session and reused for many
 * turns. They must be safe under repeated `stream(...)` calls but are not
 * required to be safe under concurrent calls — the agent loop serializes
 * turns within a single agent.
 */
export interface LLMProvider {
  /** Stable id (`"anthropic"`, `"openai"`, `"ollama"`). */
  readonly id: string;
  /** Stream a chat completion. */
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  /** Count tokens for a message list (best-effort; falls back to heuristic). */
  countTokens(messages: ChatMessage[]): Promise<number>;
}
