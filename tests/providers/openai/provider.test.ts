import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAIProvider } from "../../../src/providers/openai/provider.js";
import type { ChatRequest } from "../../../src/providers/types.js";
import type { Logger } from "../../../src/utils/logger.js";

// Mock the OpenAI SDK.
vi.mock("openai", () => {
  const mockCreate = vi.fn();
  const mockClient = {
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  };
  return {
    default: vi.fn(() => mockClient),
    __mockCreate: mockCreate,
  };
});

// Helper to create a mock logger that returns itself from child().
function createMockLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  // Make child() return the same logger so we can spy on all calls.
  (logger.child as ReturnType<typeof vi.fn>).mockReturnValue(logger);
  return logger;
}

// Helper to create a fake async iterator from an array of chunks.
function createFakeStream(chunks: unknown[]): AsyncIterable<unknown> & { controller: AbortController } {
  const controller = new AbortController();
  return {
    controller,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        if (controller.signal.aborted) {
          break;
        }
        yield chunk;
      }
    },
  };
}

describe("OpenAIProvider", () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let log: Logger;

  beforeEach(async () => {
    vi.clearAllMocks();
    const openaiModule = await import("openai");
    mockCreate = (openaiModule as unknown as { __mockCreate: typeof mockCreate }).__mockCreate;
    log = createMockLogger();
  });

  describe("constructor", () => {
    it("creates provider with required config", () => {
      const provider = new OpenAIProvider({
        apiKey: "test-key",
        log,
      });
      expect(provider.id).toBe("openai");
    });

    it("accepts optional baseUrl", () => {
      const provider = new OpenAIProvider({
        apiKey: "test-key",
        baseUrl: "https://api.example.com",
        log,
      });
      expect(provider.id).toBe("openai");
    });

    it("accepts optional id field", () => {
      const provider = new OpenAIProvider({
        apiKey: "test-key",
        log,
        id: "ollama",
      });
      expect(provider.id).toBe("ollama");
    });

    it("defaults id to openai when not specified", () => {
      const provider = new OpenAIProvider({
        apiKey: "test-key",
        log,
      });
      expect(provider.id).toBe("openai");
    });
  });

  describe("stream()", () => {
    it("yields text deltas correctly", async () => {
      const chunks = [
        {
          choices: [{ delta: { content: "Hello" }, finish_reason: null, index: 0 }],
          usage: null,
        },
        {
          choices: [{ delta: { content: " world" }, finish_reason: null, index: 0 }],
          usage: null,
        },
        {
          choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ];
      mockCreate.mockResolvedValue(createFakeStream(chunks));

      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const req: ChatRequest = {
        model: "gpt-4o",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      };
      const signal = new AbortController().signal;

      const results = [];
      for await (const chunk of provider.stream(req, signal)) {
        results.push(chunk);
      }

      expect(results).toEqual([
        { kind: "text", delta: "Hello" },
        { kind: "text", delta: " world" },
        { kind: "stop", reason: "end_turn", usage: { inputTokens: 10, outputTokens: 5 } },
      ]);
    });

    it("buffers and yields tool calls correctly", async () => {
      const chunks = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_123", function: { name: "read_file", arguments: "" } },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          usage: null,
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"path":' } }],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          usage: null,
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '"/test.txt"}' } }],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          usage: null,
        },
        {
          choices: [{ delta: {}, finish_reason: "tool_calls", index: 0 }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        },
      ];
      mockCreate.mockResolvedValue(createFakeStream(chunks));

      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const req: ChatRequest = {
        model: "gpt-4o",
        messages: [{ role: "user", content: [{ type: "text", text: "Read file" }] }],
        tools: [
          {
            name: "read_file",
            description: "Read a file",
            inputSchema: { type: "object", properties: { path: { type: "string" } } },
            source: "builtin",
          },
        ],
      };
      const signal = new AbortController().signal;

      const results = [];
      for await (const chunk of provider.stream(req, signal)) {
        results.push(chunk);
      }

      expect(results).toEqual([
        {
          kind: "tool_call",
          id: "call_123",
          name: "read_file",
          input: { path: "/test.txt" },
        },
        { kind: "stop", reason: "tool_use", usage: { inputTokens: 20, outputTokens: 10 } },
      ]);
    });

    it("handles multiple tool calls in parallel", async () => {
      const chunks = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", function: { name: "read", arguments: '{"path":"a"}' } },
                  { index: 1, id: "call_2", function: { name: "write", arguments: "" } },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          usage: null,
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 1, function: { arguments: '{"path":"b","content":"x"}' } },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          usage: null,
        },
        {
          choices: [{ delta: {}, finish_reason: "tool_calls", index: 0 }],
          usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        },
      ];
      mockCreate.mockResolvedValue(createFakeStream(chunks));

      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const req: ChatRequest = {
        model: "gpt-4o",
        messages: [{ role: "user", content: [{ type: "text", text: "Do stuff" }] }],
      };
      const signal = new AbortController().signal;

      const results = [];
      for await (const chunk of provider.stream(req, signal)) {
        results.push(chunk);
      }

      expect(results).toEqual([
        { kind: "tool_call", id: "call_1", name: "read", input: { path: "a" } },
        { kind: "tool_call", id: "call_2", name: "write", input: { path: "b", content: "x" } },
        { kind: "stop", reason: "tool_use", usage: { inputTokens: 30, outputTokens: 15 } },
      ]);
    });

    it("handles abort signal", async () => {
      const chunks = [
        {
          choices: [{ delta: { content: "Hello" }, finish_reason: null, index: 0 }],
          usage: null,
        },
        {
          choices: [{ delta: { content: " world" }, finish_reason: null, index: 0 }],
          usage: null,
        },
        {
          choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ];
      const fakeStream = createFakeStream(chunks);
      mockCreate.mockResolvedValue(fakeStream);

      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const req: ChatRequest = {
        model: "gpt-4o",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      };
      const controller = new AbortController();

      const results = [];
      let stoppedEarly = false;
      try {
        for await (const chunk of provider.stream(req, controller.signal)) {
          results.push(chunk);
          if (results.length === 1) {
            controller.abort();
          }
        }
      } catch {
        stoppedEarly = true;
      }

      // Should have yielded at least one chunk before abort.
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]).toEqual({ kind: "text", delta: "Hello" });
    });

    it("handles malformed tool input JSON gracefully", async () => {
      const chunks = [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_123", function: { name: "test", arguments: "{invalid json" } },
                ],
              },
              finish_reason: null,
              index: 0,
            },
          ],
          usage: null,
        },
        {
          choices: [{ delta: {}, finish_reason: "tool_calls", index: 0 }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      ];
      mockCreate.mockResolvedValue(createFakeStream(chunks));

      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const req: ChatRequest = {
        model: "gpt-4o",
        messages: [{ role: "user", content: [{ type: "text", text: "Test" }] }],
      };
      const signal = new AbortController().signal;

      const results = [];
      for await (const chunk of provider.stream(req, signal)) {
        results.push(chunk);
      }

      // Should default to empty object on parse failure.
      expect(results).toEqual([
        { kind: "tool_call", id: "call_123", name: "test", input: {} },
        { kind: "stop", reason: "tool_use", usage: { inputTokens: 10, outputTokens: 5 } },
      ]);
      expect(log.warn).toHaveBeenCalled();
    });

    it("includes system prompt when provided", async () => {
      const chunks = [
        {
          choices: [{ delta: { content: "OK" }, finish_reason: "stop", index: 0 }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        },
      ];
      mockCreate.mockResolvedValue(createFakeStream(chunks));

      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const req: ChatRequest = {
        model: "gpt-4o",
        system: "You are helpful",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      };
      const signal = new AbortController().signal;

      for await (const _ of provider.stream(req, signal)) {
        // consume
      }

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.messages[0]).toEqual({ role: "system", content: "You are helpful" });
    });

    it("skips stream_options for ollama provider", async () => {
      const chunks = [
        {
          choices: [{ delta: { content: "OK" }, finish_reason: "stop", index: 0 }],
          usage: null,
        },
      ];
      mockCreate.mockResolvedValue(createFakeStream(chunks));

      const provider = new OpenAIProvider({
        apiKey: "ollama",
        baseUrl: "http://localhost:11434/v1",
        log,
        id: "ollama",
      });
      const req: ChatRequest = {
        model: "llama3",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      };
      const signal = new AbortController().signal;

      for await (const _ of provider.stream(req, signal)) {
        // consume
      }

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.stream_options).toBeUndefined();
    });

    it("includes stream_options for openai provider", async () => {
      const chunks = [
        {
          choices: [{ delta: { content: "OK" }, finish_reason: "stop", index: 0 }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        },
      ];
      mockCreate.mockResolvedValue(createFakeStream(chunks));

      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const req: ChatRequest = {
        model: "gpt-4o",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      };
      const signal = new AbortController().signal;

      for await (const _ of provider.stream(req, signal)) {
        // consume
      }

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.stream_options).toEqual({ include_usage: true });
    });

    it("handles empty stream", async () => {
      mockCreate.mockResolvedValue(createFakeStream([]));

      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const req: ChatRequest = {
        model: "gpt-4o",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      };
      const signal = new AbortController().signal;

      const results = [];
      for await (const chunk of provider.stream(req, signal)) {
        results.push(chunk);
      }

      expect(results).toEqual([
        { kind: "stop", reason: "error", usage: { inputTokens: 0, outputTokens: 0 } },
      ]);
    });
  });

  describe("countTokens()", () => {
    it("returns reasonable estimates for text content", async () => {
      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const messages = [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "Hello world" }],
        },
      ];

      const count = await provider.countTokens(messages);

      // "Hello world" is 11 chars -> ceil(11/4) = 3 tokens.
      expect(count).toBe(3);
    });

    it("sums across multiple messages", async () => {
      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const messages = [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: "Hello" }],
        },
        {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "Hi there" }],
        },
      ];

      const count = await provider.countTokens(messages);

      // "Hello" = 5 chars -> 2 tokens, "Hi there" = 8 chars -> 2 tokens = 4 total.
      expect(count).toBe(4);
    });

    it("returns 0 for empty messages", async () => {
      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const messages = [
        {
          role: "user" as const,
          content: [],
        },
      ];

      const count = await provider.countTokens(messages);
      expect(count).toBe(0);
    });

    it("ignores non-text content blocks", async () => {
      const provider = new OpenAIProvider({ apiKey: "test-key", log });
      const messages = [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "Hello" },
            { type: "tool_use" as const, id: "123", name: "test", input: {} },
          ],
        },
      ];

      const count = await provider.countTokens(messages);
      expect(count).toBe(2); // Only "Hello" counted.
    });
  });
});
