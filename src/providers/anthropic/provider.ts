/**
 * Anthropic provider adapter.
 *
 * Implements the canonical {@link LLMProvider} interface on top of the
 * official `@anthropic-ai/sdk` client. Responsibilities:
 *
 *   - Translate `ChatRequest` → SDK `messages.stream(...)` request via
 *     `./mapper.ts`.
 *   - Consume the SDK's event stream and re-emit canonical `ChatChunk`
 *     events. Tool-use blocks are buffered until their `input_json_delta`
 *     fragments are complete, then emitted as a single `tool_call` chunk.
 *   - Surface a final `stop` chunk carrying the mapped `StopReason` and
 *     usage metrics.
 *
 * The adapter is stateless across `stream(...)` calls; concurrent calls
 * are safe at the SDK level but the agent loop never invokes them
 * concurrently within a single agent.
 */
import Anthropic from "@anthropic-ai/sdk";

import { mapStopReason, toAnthropicMessages, toAnthropicTools } from "./mapper.js";
import type {
  ChatChunk,
  ChatMessage,
  ChatRequest,
  LLMProvider,
  TokenUsage,
} from "../types.js";
import { estimateTokensTotal } from "../../utils/tokenCounter.js";
import type { Logger } from "../../utils/logger.js";

/** Construction options for {@link AnthropicProvider}. */
export interface AnthropicProviderOptions {
  /** API key — must be supplied; no implicit env-var lookup. */
  apiKey: string;
  /** Optional base URL override (Anthropic-compatible proxies). */
  baseUrl?: string;
  /** Logger for diagnostic messages. */
  log: Logger;
}

/**
 * Buffered state for an in-progress tool-use block.
 *
 * Anthropic streams tool-use input as a series of partial JSON fragments;
 * we accumulate the fragments into `inputJson` and parse once the block
 * stops.
 */
interface ToolUseBuffer {
  id: string;
  name: string;
  inputJson: string;
}

/** Canonical Anthropic provider implementation. */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";

  private readonly client: Anthropic;
  private readonly log: Logger;

  constructor(opts: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseUrl !== undefined ? { baseURL: opts.baseUrl } : {}),
    });
    this.log = opts.log.child({ provider: "anthropic" });
  }

  /**
   * Stream a chat completion as an async iterable of `ChatChunk` events.
   *
   * The async iterator drives the SDK stream and yields normalized chunks.
   * The caller may consume eagerly or back-pressure by awaiting between
   * iterations; the SDK respects pause-on-await semantics.
   */
  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    const stream = this.client.messages.stream({
      model: req.model,
      max_tokens: req.maxOutputTokens ?? 4096,
      messages: toAnthropicMessages(req.messages),
      ...(req.system !== undefined ? { system: req.system } : {}),
      ...(req.tools && req.tools.length > 0
        ? { tools: toAnthropicTools(req.tools) }
        : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    });

    // Wire the abort signal through so users can cancel mid-stream.
    const onAbort = (): void => {
      try {
        stream.controller.abort();
      } catch {
        /* ignore — already aborted or finalized */
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    /** Buffers indexed by SDK content-block index. */
    const toolBuffers = new Map<number, ToolUseBuffer>();

    try {
      for await (const event of stream) {
        if (signal.aborted) {
          break;
        }

        switch (event.type) {
          case "content_block_start": {
            if (event.content_block.type === "tool_use") {
              toolBuffers.set(event.index, {
                id: event.content_block.id,
                name: event.content_block.name,
                inputJson: "",
              });
            }
            break;
          }

          case "content_block_delta": {
            const delta = event.delta;
            if (delta.type === "text_delta") {
              yield { kind: "text", delta: delta.text };
            } else if (delta.type === "input_json_delta") {
              const buf = toolBuffers.get(event.index);
              if (buf) {
                buf.inputJson += delta.partial_json;
              }
            }
            break;
          }

          case "content_block_stop": {
            const buf = toolBuffers.get(event.index);
            if (buf) {
              const input = parseToolInput(buf.inputJson, this.log);
              yield {
                kind: "tool_call",
                id: buf.id,
                name: buf.name,
                input,
              };
              toolBuffers.delete(event.index);
            }
            break;
          }

          case "message_stop": {
            const finalMessage = await stream.finalMessage();
            yield {
              kind: "stop",
              reason: mapStopReason(finalMessage.stop_reason),
              usage: extractUsage(finalMessage.usage),
            };
            return;
          }
        }
      }

      // Loop exited without a `message_stop` (e.g. abort).
      yield {
        kind: "stop",
        reason: signal.aborted ? "error" : "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Best-effort token count. Uses the SDK's `countTokens` endpoint when
   * available; falls back to a character-based heuristic otherwise.
   */
  async countTokens(messages: ChatMessage[]): Promise<number> {
    try {
      const result = await this.client.messages.countTokens({
        model: "claude-opus-4-6",
        messages: toAnthropicMessages(messages),
      });
      return result.input_tokens;
    } catch (err) {
      this.log.debug("countTokens fallback to heuristic", { err });
      const texts = messages.flatMap((m) =>
        m.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text),
      );
      return estimateTokensTotal(texts);
    }
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
function extractUsage(raw: Anthropic.Messages.Usage | undefined): TokenUsage {
  return {
    inputTokens: raw?.input_tokens ?? 0,
    outputTokens: raw?.output_tokens ?? 0,
    ...(raw?.cache_read_input_tokens != null
      ? { cacheReadTokens: raw.cache_read_input_tokens }
      : {}),
    ...(raw?.cache_creation_input_tokens != null
      ? { cacheCreationTokens: raw.cache_creation_input_tokens }
      : {}),
  };
}
