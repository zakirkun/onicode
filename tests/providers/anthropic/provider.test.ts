/**
 * Unit tests for {@link AnthropicProvider}.
 *
 * Mocks the `@anthropic-ai/sdk` package so no real HTTP calls are made.
 * Exercises the event-stream → canonical-ChatChunk translation, abort
 * wiring, token counting fallback, and edge cases (malformed tool JSON,
 * empty streams).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnthropicProvider } from "../../../src/providers/anthropic/provider.js";
import type { ChatRequest, ChatChunk } from "../../../src/providers/types.js";
import type { Logger } from "../../../src/utils/logger.js";
import { createMockLogger, textMessage } from "../../helpers/fixtures.js";

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK.
// ---------------------------------------------------------------------------
const mockStream = vi.fn();
const mockCountTokens = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(() => ({
    messages: {
      stream: mockStream,
      countTokens: mockCountTokens,
    },
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake SDK stream object matching the shape the provider expects. */
function createFakeSdkStream(
  events: unknown[],
  finalMessage: unknown,
): {
  controller: { abort: ReturnType<typeof vi.fn> };
  [Symbol.asyncIterator]: () => AsyncGenerator<unknown>;
  finalMessage: ReturnType<typeof vi.fn>;
} {
  const controller = { abort: vi.fn() };
  return {
    controller,
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) {
        yield event;
      }
    },
    finalMessage: vi.fn().mockResolvedValue(finalMessage),
  };
}

/** Collect all chunks from an async iterable. */
async function collectChunks(iter: AsyncIterable<ChatChunk>): Promise<ChatChunk[]> {
  const out: ChatChunk[] = [];
  for await (const chunk of iter) {
    out.push(chunk);
  }
  return out;
}

/** Build a minimal ChatRequest. */
function makeReq(overrides?: Partial<ChatRequest>): ChatRequest {
  return {
    model: "claude-opus-4-6",
    messages: [textMessage("user", "hello")],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("AnthropicProvider", () => {
  let log: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    log = createMockLogger();
  });

  // ---- constructor ---------------------------------------------------------
  describe("constructor", () => {
    it("sets id to 'anthropic'", () => {
      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      expect(provider.id).toBe("anthropic");
    });

    it("passes baseUrl to the SDK client", async () => {
      const AnthropicModule = await import("@anthropic-ai/sdk");
      const AnthropicCtor = AnthropicModule.default as ReturnType<typeof vi.fn>;
      new AnthropicProvider({
        apiKey: "sk-ant-test",
        baseUrl: "https://proxy.example.com",
        log,
      });
      expect(AnthropicCtor).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: "https://proxy.example.com" }),
      );
    });
  });

  // ---- stream() ------------------------------------------------------------
  describe("stream()", () => {
    it("yields text deltas from content_block_start → delta → stop", async () => {
      const events = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: " world" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];
      const finalMsg = {
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const chunks = await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      expect(chunks).toEqual([
        { kind: "text", delta: "Hello" },
        { kind: "text", delta: " world" },
        {
          kind: "stop",
          reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ]);
    });

    it("yields tool_call chunks from tool_use blocks", async () => {
      const events = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu_1", name: "read_file" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"path": "/tm' },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: 'p/test.txt"}' },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];
      const finalMsg = {
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 8 },
      };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const chunks = await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      expect(chunks).toEqual([
        {
          kind: "tool_call",
          id: "tu_1",
          name: "read_file",
          input: { path: "/tmp/test.txt" },
        },
        {
          kind: "stop",
          reason: "tool_use",
          usage: { inputTokens: 20, outputTokens: 8 },
        },
      ]);
    });

    it("breaks the loop when abort signal fires", async () => {
      const controller = new AbortController();

      // Build an event list that would produce text + stop if fully consumed.
      const events = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "first" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "second" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];
      const finalMsg = {
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 3 },
      };

      // Wrap the stream so we can detect abort between events.
      const inner = createFakeSdkStream(events, finalMsg);
      const origIterator = inner[Symbol.asyncIterator].bind(inner);
      let yielded = 0;
      const wrappedStream = {
        controller: inner.controller,
        finalMessage: inner.finalMessage,
        [Symbol.asyncIterator]: async function* () {
          const gen = origIterator();
          for (;;) {
            const next = await gen.next();
            if (next.done) return;
            yielded++;
            yield next.value;
            // After yielding the first text delta, abort.
            if (yielded === 2) {
              controller.abort();
            }
          }
        },
      };
      mockStream.mockReturnValue(wrappedStream);

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const chunks = await collectChunks(
        provider.stream(makeReq(), controller.signal),
      );

      // Should have at least the first text delta, but not necessarily all events.
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]).toEqual({ kind: "text", delta: "first" });

      // The final chunk is a stop; since we aborted, usage is zero.
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk?.kind).toBe("stop");
    });

    it("extracts usage including cache tokens from finalMessage", async () => {
      const events = [{ type: "message_stop" }];
      const finalMsg = {
        stop_reason: "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 20,
        },
      };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const chunks = await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      expect(chunks).toEqual([
        {
          kind: "stop",
          reason: "end_turn",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 30,
            cacheCreationTokens: 20,
          },
        },
      ]);
    });

    it("passes system prompt to the SDK when provided", async () => {
      const events = [{ type: "message_stop" }];
      const finalMsg = { stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      await collectChunks(
        provider.stream(
          makeReq({ system: "You are helpful" }),
          new AbortController().signal,
        ),
      );

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({ system: "You are helpful" }),
      );
    });

    it("omits system from SDK call when not provided", async () => {
      const events = [{ type: "message_stop" }];
      const finalMsg = { stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty("system");
    });

    it("handles an empty stream (just message_stop)", async () => {
      const events = [{ type: "message_stop" }];
      const finalMsg = { stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 0 } };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const chunks = await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      expect(chunks).toEqual([
        {
          kind: "stop",
          reason: "end_turn",
          usage: { inputTokens: 3, outputTokens: 0 },
        },
      ]);
    });

    it("defaults malformed tool input JSON to {}", async () => {
      const events = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu_bad", name: "test_tool" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: "{invalid json" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];
      const finalMsg = {
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const chunks = await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      expect(chunks).toEqual([
        { kind: "tool_call", id: "tu_bad", name: "test_tool", input: {} },
        {
          kind: "stop",
          reason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ]);
      expect(log.warn).toHaveBeenCalledWith(
        "malformed tool input JSON; defaulting to {}",
        expect.any(Object),
      );
    });

    it("defaults empty tool input JSON to {}", async () => {
      const events = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: "tu_empty", name: "noop" },
        },
        // No input_json_delta events at all.
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];
      const finalMsg = {
        stop_reason: "tool_use",
        usage: { input_tokens: 5, output_tokens: 2 },
      };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const chunks = await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      expect(chunks).toEqual([
        { kind: "tool_call", id: "tu_empty", name: "noop", input: {} },
        {
          kind: "stop",
          reason: "tool_use",
          usage: { inputTokens: 5, outputTokens: 2 },
        },
      ]);
    });

    it("passes tools to the SDK when provided in the request", async () => {
      const events = [{ type: "message_stop" }];
      const finalMsg = { stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      await collectChunks(
        provider.stream(
          makeReq({
            tools: [
              {
                name: "read_file",
                description: "Read a file",
                inputSchema: {
                  type: "object",
                  properties: { path: { type: "string" } },
                },
                source: "builtin",
              },
            ],
          }),
          new AbortController().signal,
        ),
      );

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              name: "read_file",
              description: "Read a file",
              input_schema: {
                type: "object",
                properties: { path: { type: "string" } },
              },
            },
          ],
        }),
      );
    });

    it("streams thinking deltas from thinking content blocks", async () => {
      const events = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Let me think..." },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: " about this." },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "text_delta", text: "Here is my answer." },
        },
        { type: "content_block_stop", index: 1 },
        { type: "message_stop" },
      ];
      const finalMsg = {
        stop_reason: "end_turn",
        usage: { input_tokens: 50, output_tokens: 20 },
      };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const chunks = await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      expect(chunks).toEqual([
        { kind: "thinking", delta: "Let me think..." },
        { kind: "thinking", delta: " about this." },
        { kind: "text", delta: "Here is my answer." },
        {
          kind: "stop",
          reason: "end_turn",
          usage: { inputTokens: 50, outputTokens: 20 },
        },
      ]);
    });

    it("does not emit tool_call for thinking content blocks", async () => {
      const events = [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "pondering" },
        },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ];
      const finalMsg = {
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const chunks = await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      // No tool_call chunks should appear.
      expect(chunks.find((c) => c.kind === "tool_call")).toBeUndefined();
      expect(chunks).toEqual([
        { kind: "thinking", delta: "pondering" },
        {
          kind: "stop",
          reason: "end_turn",
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ]);
    });

    it("passes thinking config with budget_tokens to the SDK", async () => {
      const events = [{ type: "message_stop" }];
      const finalMsg = { stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      await collectChunks(
        provider.stream(
          makeReq({ thinking: { type: "enabled", budgetTokens: 1024 } }),
          new AbortController().signal,
        ),
      );

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: { type: "enabled", budget_tokens: 1024 },
        }),
      );
    });

    it("omits thinking from SDK call when not provided", async () => {
      const events = [{ type: "message_stop" }];
      const finalMsg = { stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      await collectChunks(
        provider.stream(makeReq(), new AbortController().signal),
      );

      const callArgs = mockStream.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs).not.toHaveProperty("thinking");
    });

    it("passes temperature to the SDK when provided", async () => {
      const events = [{ type: "message_stop" }];
      const finalMsg = { stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 1 } };
      mockStream.mockReturnValue(createFakeSdkStream(events, finalMsg));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      await collectChunks(
        provider.stream(
          makeReq({ temperature: 0.7 }),
          new AbortController().signal,
        ),
      );

      expect(mockStream).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.7 }),
      );
    });
  });

  // ---- countTokens() -------------------------------------------------------
  describe("countTokens()", () => {
    it("returns SDK result when countTokens succeeds", async () => {
      mockCountTokens.mockResolvedValue({ input_tokens: 42 });

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const count = await provider.countTokens([textMessage("user", "hello")]);

      expect(count).toBe(42);
    });

    it("falls back to heuristic when SDK throws", async () => {
      mockCountTokens.mockRejectedValue(new Error("API unavailable"));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const count = await provider.countTokens([textMessage("user", "Hello world")]);

      // "Hello world" = 11 chars → ceil(11/4) = 3.
      expect(count).toBe(3);
      expect(log.debug).toHaveBeenCalledWith(
        "countTokens fallback to heuristic",
        expect.any(Object),
      );
    });

    it("heuristic sums across multiple messages", async () => {
      mockCountTokens.mockRejectedValue(new Error("API unavailable"));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const count = await provider.countTokens([
        textMessage("user", "Hello"),
        textMessage("assistant", "Hi there"),
      ]);

      // "Hello" = 5 chars → 2, "Hi there" = 8 chars → 2, total = 4.
      expect(count).toBe(4);
    });

    it("heuristic returns 0 for empty content", async () => {
      mockCountTokens.mockRejectedValue(new Error("API unavailable"));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const count = await provider.countTokens([
        { role: "user", content: [] },
      ]);

      expect(count).toBe(0);
    });

    it("heuristic ignores non-text blocks", async () => {
      mockCountTokens.mockRejectedValue(new Error("API unavailable"));

      const provider = new AnthropicProvider({ apiKey: "sk-ant-test", log });
      const count = await provider.countTokens([
        {
          role: "user",
          content: [
            { type: "text", text: "Hello" },
            { type: "tool_use", id: "123", name: "test", input: {} },
          ],
        },
      ]);

      // Only "Hello" (5 chars → 2 tokens) is counted.
      expect(count).toBe(2);
    });
  });
});
