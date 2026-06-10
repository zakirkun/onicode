/**
 * OpenAI provider adapter.
 *
 * Implements the canonical {@link LLMProvider} interface on top of the
 * official `openai` SDK client. Responsibilities:
 *
 *   - Translate `ChatRequest` -> SDK `chat.completions.create(...)` request
 *     via `./mapper.ts`.
 *   - Consume the SDK's streaming chunks and re-emit canonical `ChatChunk`
 *     events. Tool-call argument fragments are buffered until the stream
 *     finishes a tool call, then emitted as a single `tool_call` chunk.
 *   - Surface a final `stop` chunk carrying the mapped `StopReason` and
 *     usage metrics from the final chunk.
 *
 * The adapter is stateless across `stream(...)` calls; concurrent calls
 * are safe at the SDK level but the agent loop never invokes them
 * concurrently within a single agent.
 */
import OpenAI from "openai";

import { mapOpenAIStopReason, toOpenAIMessages, toOpenAITools } from "./mapper.js";
import type {
  ChatChunk,
  ChatMessage,
  ChatRequest,
  LLMProvider,
  TokenUsage,
} from "../types.js";
import { estimateTokensTotal } from "../../utils/tokenCounter.js";
import type { Logger } from "../../utils/logger.js";

/** Construction options for {@link OpenAIProvider}. */
export interface OpenAIProviderOptions {
  /** API key -- must be supplied; no implicit env-var lookup. */
  apiKey: string;
  /** Optional base URL override (OpenAI-compatible proxies). */
  baseUrl?: string;
  /** Logger for diagnostic messages. */
  log: Logger;
  /** Provider id: "openai" (default) or "ollama". Controls SDK behavior differences. */
  id?: "openai" | "ollama";
}

/**
 * Buffered state for an in-progress tool call.
 *
 * OpenAI streams tool-call arguments as a series of JSON string fragments
 * in `delta.tool_calls[].function.arguments`. We accumulate the fragments
 * into `argumentsJson` and parse once the stream finishes.
 */
interface ToolCallBuffer {
  id: string;
  name: string;
  argumentsJson: string;
}

/** Canonical OpenAI provider implementation. */
export class OpenAIProvider implements LLMProvider {
  readonly id: string;

  private readonly client: OpenAI;
  private readonly log: Logger;

  constructor(opts: OpenAIProviderOptions) {
    this.id = opts.id ?? "openai";
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      ...(opts.baseUrl !== undefined ? { baseURL: opts.baseUrl } : {}),
    });
    this.log = opts.log.child({ provider: this.id });
  }

  /**
   * Stream a chat completion as an async iterable of `ChatChunk` events.
   *
   * The async iterator drives the SDK stream and yields normalized chunks.
   * The caller may consume eagerly or back-pressure by awaiting between
   * iterations; the SDK respects pause-on-await semantics.
   */
  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const stream = await this.client.chat.completions.create(
      {
        model: req.model,
        max_tokens: req.maxOutputTokens ?? 4096,
        messages: [
          ...(req.system !== undefined
            ? [{ role: "system" as const, content: req.system }]
            : []),
          ...toOpenAIMessages(req.messages),
        ],
        ...(req.tools && req.tools.length > 0
          ? { tools: toOpenAITools(req.tools) }
          : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        stream: true,
        // Ollama's OpenAI-compat layer does not support stream_options; skip it.
        ...(this.id !== "ollama" ? { stream_options: { include_usage: true } } : {}),
      },
    );

    // Wire the abort signal through so users can cancel mid-stream.
    const onAbort = (): void => {
      try {
        stream.controller.abort();
      } catch {
        /* ignore -- already aborted or finalized */
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    /** Buffers indexed by tool_calls array index in the chunk. */
    const toolBuffers = new Map<number, ToolCallBuffer>();

    /** Last-known finish reason from the stream. */
    let lastFinishReason: string | null = null;
    /** Last-known usage from the stream (only present on final chunk). */
    let lastUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      for await (const chunk of stream) {
        if (signal.aborted) {
          break;
        }

        // Usage may appear on the final chunk (or standalone usage chunk).
        if (chunk.usage) {
          lastUsage = extractUsage(chunk.usage);
        }

        for (const choice of chunk.choices) {
          const { delta, finish_reason } = choice;

          if (finish_reason) {
            lastFinishReason = finish_reason;
          }

          // Text content delta.
          if (delta.content != null && delta.content.length > 0) {
            yield { kind: "text", delta: delta.content };
          }

          // Reasoning content from reasoning models (o1, o3, o4-mini).
          // The SDK doesn't type this, so cast through unknown.
          const reasoning = (delta as unknown as { reasoning_content?: string }).reasoning_content;
          if (reasoning != null && reasoning.length > 0) {
            yield { kind: "thinking", delta: reasoning };
          }

          // Tool-call argument fragments.
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              let buf = toolBuffers.get(idx);

              // First fragment for this index: initialize the buffer.
              if (!buf) {
                buf = {
                  id: tc.id ?? "",
                  name: tc.function?.name ?? "",
                  argumentsJson: "",
                };
                toolBuffers.set(idx, buf);
              }

              // Update id/name if present in later fragments (rare, but safe).
              if (tc.id) {
                buf.id = tc.id;
              }
              if (tc.function?.name) {
                buf.name = tc.function.name;
              }
              if (tc.function?.arguments) {
                buf.argumentsJson += tc.function.arguments;
              }
            }
          }
        }

        // When the stream signals a finish_reason, flush all buffered tool calls.
        if (lastFinishReason && toolBuffers.size > 0) {
          // Sort by index for deterministic ordering.
          const sorted = [...toolBuffers.entries()].sort(([a], [b]) => a - b);
          for (const [, buf] of sorted) {
            const input = parseToolInput(buf.argumentsJson, this.log);
            yield {
              kind: "tool_call",
              id: buf.id,
              name: buf.name,
              input,
            };
          }
          toolBuffers.clear();
        }
      }

      // If we exited the loop without finish_reason (abort or error), still flush
      // any buffered tool calls so the caller does not lose them.
      if (toolBuffers.size > 0) {
        const sorted = [...toolBuffers.entries()].sort(([a], [b]) => a - b);
        for (const [, buf] of sorted) {
          const input = parseToolInput(buf.argumentsJson, this.log);
          yield {
            kind: "tool_call",
            id: buf.id,
            name: buf.name,
            input,
          };
        }
        toolBuffers.clear();
      }

      // Emit the stop chunk.
      yield {
        kind: "stop",
        reason: signal.aborted
          ? "error"
          : mapOpenAIStopReason(lastFinishReason),
        usage: lastUsage,
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Best-effort token count. Falls back to the character-based heuristic
   * since OpenAI does not expose a standalone countTokens endpoint for
   * chat completions in the same way Anthropic does.
   */
  async countTokens(messages: ChatMessage[]): Promise<number> {
    const texts = messages.flatMap((m) =>
      m.content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text),
    );
    return estimateTokensTotal(texts);
  }
}

/** Parse a buffered tool input JSON string; return `{}` on failure. */
function parseToolInput(json: string, log: Logger): unknown {
  if (!json.trim()) {
    return {};
  }
  try {
    return JSON.parse(json);
  } catch (err) {
    log.warn("malformed tool input JSON; defaulting to {}", { err, json });
    return {};
  }
}

/** Convert SDK usage shape to canonical `TokenUsage`. */
function extractUsage(raw: OpenAI.Completions.CompletionUsage): TokenUsage {
  return {
    inputTokens: raw.prompt_tokens ?? 0,
    outputTokens: raw.completion_tokens ?? 0,
  };
}
