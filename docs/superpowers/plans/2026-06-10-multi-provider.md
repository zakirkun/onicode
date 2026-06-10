# v0.5 Multi-Provider Support — OpenAI + Ollama Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI and Ollama provider adapters using shared `openai` SDK, enabling OniCode to work with multiple LLM ecosystems.

**Architecture:** Both OpenAI and Ollama use the `openai` npm SDK since Ollama exposes an OpenAI-compatible API. One mapper (pure conversions), one provider class (SDK integration + streaming), config-driven difference (Ollama uses different baseUrl + fake apiKey).

**Tech Stack:** TypeScript, `openai` npm SDK (v4.x), vitest (testing), existing OniCode provider abstraction.

---

## Task 1: Add `openai` Dependency + Update Defaults

**Files:**
- Modify: `package.json` (add dependency)
- Modify: `src/config/defaults.ts` (add provider defaults)

- [ ] **Step 1: Add openai to package.json dependencies**

Open `package.json` and add to `dependencies`:

```json
{
  "dependencies": {
    "openai": "^4.73.0"
  }
}
```

Run: `pnpm install`

Expected: `openai` package installed, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Update DEFAULT_CONFIG in defaults.ts**

Open `src/config/defaults.ts` and add OpenAI + Ollama to the `providers` section:

```typescript
export const DEFAULT_CONFIG: OnicodeConfig = {
  defaultProvider: "anthropic",
  defaultModel: "claude-sonnet-4-20250514",
  providers: {
    anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
    openai: { apiKeyEnv: "OPENAI_API_KEY" },
    ollama: { baseUrl: "http://localhost:11434/v1" },
  },
  // ... rest of config
};
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm typecheck`

Expected: No errors. The `ProviderId` type already includes `"openai" | "ollama"`, so adding them to defaults is type-safe.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/config/defaults.ts
git commit -m "chore: add openai dependency and provider defaults for v0.5"
```

---

## Task 2: Implement OpenAI Mapper (Pure Functions + Tests)

**Files:**
- Create: `src/providers/openai/mapper.ts`
- Create: `tests/providers/openai/mapper.test.ts`

- [ ] **Step 1: Write failing test for toOpenAIMessages()**

Create `tests/providers/openai/mapper.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { toOpenAIMessages } from "../../../src/providers/openai/mapper.js";
import type { ChatMessage } from "../../../src/providers/types.js";

describe("toOpenAIMessages", () => {
  it("maps user message with text content", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("maps assistant message with text content", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([{ role: "assistant", content: "Hi there" }]);
  });

  it("maps tool result message", () => {
    const messages: ChatMessage[] = [
      {
        role: "tool",
        content: [{ type: "tool_result", toolUseId: "call_123", content: "result" }],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      { role: "tool", tool_call_id: "call_123", content: "result" },
    ]);
  });

  it("drops system messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: [{ type: "text", text: "You are helpful" }] },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("concatenates multiple text blocks", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Line 1\n" },
          { type: "text", text: "Line 2" },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([{ role: "user", content: "Line 1\nLine 2" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/providers/openai/mapper.test.ts`

Expected: FAIL with "Cannot find module" or "toOpenAIMessages is not a function".

- [ ] **Step 3: Implement toOpenAIMessages()**

Create `src/providers/openai/mapper.ts`:

```typescript
/**
 * OpenAI message and tool format mappers.
 *
 * Pure functions converting canonical chat types to OpenAI SDK format.
 * No I/O, no side effects.
 */
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import type { ChatMessage, ToolDefinition } from "../types.js";

/**
 * Convert canonical ChatMessage[] to OpenAI message format.
 *
 * - System messages are dropped (extracted separately as `system` param).
 * - Tool results become `{ role: "tool", tool_call_id, content }`.
 * - Multiple text blocks are concatenated into single `content` string.
 */
export function toOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg) => {
      if (msg.role === "tool") {
        // Tool result message
        const toolResult = msg.content[0];
        if (toolResult?.type !== "tool_result") {
          throw new Error("Tool message must have tool_result content");
        }
        return {
          role: "tool" as const,
          tool_call_id: toolResult.toolUseId,
          content: toolResult.content,
        };
      }

      // User or assistant message — concatenate text blocks
      const text = msg.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { type: "text"; text: string }).text)
        .join("");

      return {
        role: msg.role,
        content: text,
      };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/providers/openai/mapper.test.ts`

Expected: All 5 tests PASS.

- [ ] **Step 5: Write failing test for toOpenAITools()**

Add to `tests/providers/openai/mapper.test.ts`:

```typescript
import { toOpenAIMessages, toOpenAITools } from "../../../src/providers/openai/mapper.js";

describe("toOpenAITools", () => {
  it("maps tool definition to OpenAI function format", () => {
    const tools: ToolDefinition[] = [
      {
        name: "read_file",
        description: "Read a file from disk",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
      },
    ];
    const result = toOpenAITools(tools);
    expect(result).toEqual([
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file from disk",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        },
      },
    ]);
  });

  it("returns empty array when no tools", () => {
    const result = toOpenAITools([]);
    expect(result).toEqual([]);
  });

  it("maps multiple tools", () => {
    const tools: ToolDefinition[] = [
      { name: "tool1", description: "First tool", inputSchema: { type: "object", properties: {} } },
      { name: "tool2", description: "Second tool", inputSchema: { type: "object", properties: {} } },
    ];
    const result = toOpenAITools(tools);
    expect(result).toHaveLength(2);
    expect(result[0]?.function.name).toBe("tool1");
    expect(result[1]?.function.name).toBe("tool2");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test tests/providers/openai/mapper.test.ts`

Expected: FAIL with "toOpenAITools is not a function".

- [ ] **Step 7: Implement toOpenAITools()**

Add to `src/providers/openai/mapper.ts`:

```typescript
/**
 * Convert canonical ToolDefinition[] to OpenAI function calling format.
 *
 * OpenAI tools use `{ type: "function", function: { name, description, parameters } }`.
 */
export function toOpenAITools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test tests/providers/openai/mapper.test.ts`

Expected: All 8 tests PASS.

- [ ] **Step 9: Write failing test for mapOpenAIStopReason()**

Add to `tests/providers/openai/mapper.test.ts`:

```typescript
import { toOpenAIMessages, toOpenAITools, mapOpenAIStopReason } from "../../../src/providers/openai/mapper.js";

describe("mapOpenAIStopReason", () => {
  it("maps 'stop' to 'end_turn'", () => {
    expect(mapOpenAIStopReason("stop")).toBe("end_turn");
  });

  it("maps 'tool_calls' to 'tool_use'", () => {
    expect(mapOpenAIStopReason("tool_calls")).toBe("tool_use");
  });

  it("maps 'length' to 'max_tokens'", () => {
    expect(mapOpenAIStopReason("length")).toBe("max_tokens");
  });

  it("maps 'content_filter' to 'stop_sequence'", () => {
    expect(mapOpenAIStopReason("content_filter")).toBe("stop_sequence");
  });

  it("maps null to 'error'", () => {
    expect(mapOpenAIStopReason(null)).toBe("error");
  });

  it("maps unknown string to 'error'", () => {
    expect(mapOpenAIStopReason("unknown")).toBe("error");
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm test tests/providers/openai/mapper.test.ts`

Expected: FAIL with "mapOpenAIStopReason is not a function".

- [ ] **Step 11: Implement mapOpenAIStopReason()**

Add to `src/providers/openai/mapper.ts`:

```typescript
import type { StopReason } from "../types.js";

/**
 * Map OpenAI finish_reason to canonical StopReason.
 *
 * - "stop" → "end_turn"
 * - "tool_calls" → "tool_use"
 * - "length" → "max_tokens"
 * - "content_filter" → "stop_sequence"
 * - null / other → "error"
 */
export function mapOpenAIStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "stop_sequence";
    default:
      return "error";
  }
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `pnpm test tests/providers/openai/mapper.test.ts`

Expected: All 14 tests PASS.

- [ ] **Step 13: Verify typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 14: Commit**

```bash
git add src/providers/openai/mapper.ts tests/providers/openai/mapper.test.ts
git commit -m "feat: implement OpenAI mapper (pure conversions for messages, tools, stop reasons)"
```

---

## Task 3: Implement OpenAI Provider (SDK Integration + Streaming + Tests)

**Files:**
- Create: `src/providers/openai/provider.ts`
- Create: `tests/providers/openai/provider.test.ts`

- [ ] **Step 1: Write failing test for provider construction**

Create `tests/providers/openai/provider.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { OpenAIProvider } from "../../../src/providers/openai/provider.js";
import { NULL_LOGGER } from "../../../src/utils/logger.js";

describe("OpenAIProvider", () => {
  it("constructs with apiKey and optional baseUrl", () => {
    const provider = new OpenAIProvider(
      { apiKey: "test-key", baseUrl: "https://api.openai.com/v1" },
      NULL_LOGGER,
    );
    expect(provider.id).toBe("openai");
  });

  it("constructs for Ollama with different config", () => {
    const provider = new OpenAIProvider(
      { apiKey: "ollama", baseUrl: "http://localhost:11434/v1", id: "ollama" },
      NULL_LOGGER,
    );
    expect(provider.id).toBe("ollama");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/providers/openai/provider.test.ts`

Expected: FAIL with "Cannot find module" or "OpenAIProvider is not a constructor".

- [ ] **Step 3: Implement OpenAIProvider constructor**

Create `src/providers/openai/provider.ts`:

```typescript
/**
 * OpenAI / Ollama provider using shared openai SDK.
 *
 * Handles streaming chat completions with tool-call buffering and abort signal.
 * Ollama uses same class with different config (baseUrl + fake apiKey).
 */
import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { LLMProvider, ChatRequest, ChatChunk, ChatMessage } from "../types.js";
import type { Logger } from "../../utils/logger.js";
import { toOpenAIMessages, toOpenAITools, mapOpenAIStopReason } from "./mapper.js";

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  id?: "openai" | "ollama";
}

/**
 * Buffer for accumulating tool-call arguments during streaming.
 *
 * OpenAI streams tool-call input as JSON fragments; we accumulate by index
 * and parse on finish_reason.
 */
interface ToolCallBuffer {
  [index: number]: {
    id: string;
    name: string;
    arguments: string;
  };
}

export class OpenAIProvider implements LLMProvider {
  readonly id: string;
  private client: OpenAI;
  private log: Logger;

  constructor(config: OpenAIProviderConfig, log: Logger) {
    this.id = config.id ?? "openai";
    this.log = log;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
    // Implemented in next step
    throw new Error("Not implemented");
  }

  async countTokens(messages: ChatMessage[]): Promise<number> {
    // Implemented in next step
    throw new Error("Not implemented");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/providers/openai/provider.test.ts`

Expected: Both construction tests PASS.

- [ ] **Step 5: Write failing test for stream() with text response**

Add to `tests/providers/openai/provider.test.ts`:

```typescript
import type { ChatRequest } from "../../../src/providers/types.js";

describe("OpenAIProvider.stream", () => {
  it("yields text chunks from streaming response", async () => {
    // Mock SDK response
    const mockStream = (async function* () {
      yield {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            delta: { content: "Hello" },
            finish_reason: null,
          },
        ],
      } as ChatCompletionChunk;
      yield {
        id: "chatcmpl-123",
        object: "chat.completion.chunk",
        created: 1234567890,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            delta: { content: " world" },
            finish_reason: "stop",
          },
        ],
      } as ChatCompletionChunk;
    })();

    const provider = new OpenAIProvider({ apiKey: "test" }, NULL_LOGGER);
    // Mock the client method
    // Mock the internal client — use Object.assign to inject mock without `any`
    Object.assign(provider, {
      client: { chat: { completions: { create: async () => mockStream } } },
    });

    const req: ChatRequest = {
      model: "gpt-4o",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      tools: [],
    };

    const chunks: ChatChunk[] = [];
    for await (const chunk of provider.stream(req, new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { kind: "text", delta: "Hello" },
      { kind: "text", delta: " world" },
      { kind: "stop", reason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test tests/providers/openai/provider.test.ts`

Expected: FAIL with "Not implemented" or iteration error.

- [ ] **Step 7: Implement stream() method**

Replace the `stream()` method in `src/providers/openai/provider.ts`:

```typescript
async *stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
  const messages = toOpenAIMessages(req.messages);
  const tools = req.tools.length > 0 ? toOpenAITools(req.tools) : undefined;

  // Ollama rejects stream_options, so only include for OpenAI
  const streamOptions =
    this.id === "openai" ? { stream_options: { include_usage: true } } : {};

  const stream = await this.client.chat.completions.create({
    model: req.model,
    messages,
    tools,
    temperature: req.temperature,
    max_tokens: req.maxOutputTokens,
    stream: true,
    ...streamOptions,
  });

  // Wire abort signal
  signal.addEventListener("abort", () => {
    stream.controller.abort();
  });

  const toolBuffer: ToolCallBuffer = {};

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    const delta = choice.delta;

    // Text content
    if (delta.content) {
      yield { kind: "text", delta: delta.content };
    }

    // Tool calls — accumulate fragments
    if (delta.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        const idx = toolCall.index;
        if (!toolBuffer[idx]) {
          toolBuffer[idx] = {
            id: toolCall.id ?? "",
            name: toolCall.function?.name ?? "",
            arguments: "",
          };
        }
        if (toolCall.function?.arguments) {
          toolBuffer[idx]!.arguments += toolCall.function.arguments;
        }
      }
    }

    // Finish reason — flush tool calls and yield stop
    if (choice.finish_reason) {
      // Yield any buffered tool calls
      for (const idx of Object.keys(toolBuffer).map(Number).sort()) {
        const buffered = toolBuffer[idx]!;
        let input: unknown;
        try {
          input = JSON.parse(buffered.arguments);
        } catch {
          this.log.warn(`Failed to parse tool-call arguments for index ${idx}`);
          input = {};
        }
        yield {
          kind: "tool_call",
          id: buffered.id,
          name: buffered.name,
          input,
        };
      }

      // Yield stop
      yield {
        kind: "stop",
        reason: mapOpenAIStopReason(choice.finish_reason),
        usage: {
          inputTokens: chunk.usage?.prompt_tokens ?? 0,
          outputTokens: chunk.usage?.completion_tokens ?? 0,
        },
      };
    }
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test tests/providers/openai/provider.test.ts`

Expected: Text streaming test PASS.

- [ ] **Step 9: Write failing test for stream() with tool calls**

Add to `tests/providers/openai/provider.test.ts`:

```typescript
it("buffers tool-call arguments and yields tool_call chunks", async () => {
  const mockStream = (async function* () {
    // Tool call start
    yield {
      id: "chatcmpl-456",
      object: "chat.completion.chunk",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_abc",
                type: "function",
                function: { name: "read_file", arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    } as ChatCompletionChunk;
    // Argument fragment 1
    yield {
      id: "chatcmpl-456",
      object: "chat.completion.chunk",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"path":' } }],
          },
          finish_reason: null,
        },
      ],
    } as ChatCompletionChunk;
    // Argument fragment 2
    yield {
      id: "chatcmpl-456",
      object: "chat.completion.chunk",
      created: 1234567890,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '"/test.txt"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    } as ChatCompletionChunk;
  })();

  const provider = new OpenAIProvider({ apiKey: "test" }, NULL_LOGGER);
  (provider as any).client.chat.completions.create = async () => mockStream;

  const req: ChatRequest = {
    model: "gpt-4o",
    messages: [{ role: "user", content: [{ type: "text", text: "Read file" }] }],
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      },
    ],
  };

  const chunks: ChatChunk[] = [];
  for await (const chunk of provider.stream(req, new AbortController().signal)) {
    chunks.push(chunk);
  }

  expect(chunks).toEqual([
    {
      kind: "tool_call",
      id: "call_abc",
      name: "read_file",
      input: { path: "/test.txt" },
    },
    { kind: "stop", reason: "tool_use", usage: { inputTokens: 0, outputTokens: 0 } },
  ]);
});
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm test tests/providers/openai/provider.test.ts`

Expected: Tool-call buffering test PASS.

- [ ] **Step 11: Write failing test for countTokens()**

Add to `tests/providers/openai/provider.test.ts`:

```typescript
describe("OpenAIProvider.countTokens", () => {
  it("returns token count from API response", async () => {
    const provider = new OpenAIProvider({ apiKey: "test" }, NULL_LOGGER);
    // Mock to return usage in response
    (provider as any).client.chat.completions.create = async () => ({
      usage: { prompt_tokens: 50, completion_tokens: 1 },
    });

    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    const count = await provider.countTokens(messages);
    expect(count).toBe(50);
  });

  it("falls back to heuristic when API unavailable", async () => {
    const provider = new OpenAIProvider({ apiKey: "test" }, NULL_LOGGER);
    (provider as any).client.chat.completions.create = async () => {
      throw new Error("API unavailable");
    };

    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello world" }] },
    ];
    const count = await provider.countTokens(messages);
    // Heuristic: ~4 chars per token, "Hello world" = 11 chars ≈ 3 tokens
    expect(count).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 12: Run test to verify it fails**

Run: `pnpm test tests/providers/openai/provider.test.ts`

Expected: FAIL with "Not implemented".

- [ ] **Step 13: Implement countTokens() method**

Replace the `countTokens()` method in `src/providers/openai/provider.ts`:

```typescript
async countTokens(messages: ChatMessage[]): Promise<number> {
  try {
    // Use minimal request to get token count from response
    const response = await this.client.chat.completions.create({
      model: "gpt-3.5-turbo", // Cheapest model for counting
      messages: toOpenAIMessages(messages),
      max_tokens: 1,
    });
    return response.usage?.prompt_tokens ?? this.heuristicCount(messages);
  } catch (err) {
    this.log.warn(`Token counting failed, using heuristic: ${err}`);
    return this.heuristicCount(messages);
  }
}

private heuristicCount(messages: ChatMessage[]): number {
  // Rough heuristic: ~4 chars per token
  const totalChars = messages.reduce((sum, msg) => {
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    return sum + text.length;
  }, 0);
  return Math.ceil(totalChars / 4);
}
```

- [ ] **Step 14: Run test to verify it passes**

Run: `pnpm test tests/providers/openai/provider.test.ts`

Expected: All countTokens tests PASS.

- [ ] **Step 15: Verify all tests pass**

Run: `pnpm test tests/providers/openai/`

Expected: All mapper + provider tests PASS.

- [ ] **Step 16: Verify typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 17: Commit**

```bash
git add src/providers/openai/provider.ts tests/providers/openai/provider.test.ts
git commit -m "feat: implement OpenAI provider (streaming, tool-call buffering, abort signal)"
```

---

## Task 4: Wire Up Provider Factory + Smoke Test

**Files:**
- Modify: `src/providers/registry.ts` (replace stub cases)

- [ ] **Step 1: Write failing smoke test for factory**

Create `tests/providers/registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createProvider } from "../../src/providers/registry.js";
import { NULL_LOGGER } from "../../src/utils/logger.js";
import type { ProviderConfig } from "../../src/config/types.js";

describe("createProvider", () => {
  it("creates OpenAI provider", () => {
    const config: ProviderConfig = { apiKeyEnv: "OPENAI_API_KEY" };
    process.env.OPENAI_API_KEY = "test-key";
    const provider = createProvider("openai", config, NULL_LOGGER);
    expect(provider.id).toBe("openai");
    delete process.env.OPENAI_API_KEY;
  });

  it("creates Ollama provider", () => {
    const config: ProviderConfig = { baseUrl: "http://localhost:11434/v1" };
    const provider = createProvider("ollama", config, NULL_LOGGER);
    expect(provider.id).toBe("ollama");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/providers/registry.test.ts`

Expected: FAIL with "Provider 'openai' is not yet implemented".

- [ ] **Step 3: Update registry.ts to wire up OpenAI provider**

Open `src/providers/registry.ts` and replace the stub cases:

```typescript
import { OpenAIProvider } from "./openai/provider.js";

export function createProvider(
  id: ProviderId,
  config: ProviderConfig,
  log: Logger,
): LLMProvider {
  switch (id) {
    case "anthropic": {
      const apiKey = readApiKey(config, "ANTHROPIC_API_KEY");
      return new AnthropicProvider({ apiKey, baseUrl: config.baseUrl }, log);
    }
    case "openai": {
      const apiKey = readApiKey(config, "OPENAI_API_KEY");
      return new OpenAIProvider({ apiKey, baseUrl: config.baseUrl }, log);
    }
    case "ollama": {
      // Ollama ignores apiKey but SDK requires a value
      return new OpenAIProvider(
        {
          apiKey: "ollama",
          baseUrl: config.baseUrl ?? "http://localhost:11434/v1",
          id: "ollama",
        },
        log,
      );
    }
    default:
      throw new Error(`Unknown provider: ${id}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/providers/registry.test.ts`

Expected: Both factory tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `pnpm test`

Expected: All tests PASS (mapper + provider + registry + existing tests).

- [ ] **Step 6: Verify typecheck and build**

Run: `pnpm typecheck && pnpm build`

Expected: No errors. Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/providers/registry.ts tests/providers/registry.test.ts
git commit -m "feat: wire up OpenAI and Ollama providers in factory"
```

---

## Task 5: Documentation Updates (CLAUDE.md)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add v0.5 status section to CLAUDE.md**

Open `CLAUDE.md` and add after the v0.4 status section:

```markdown
**v0.5 — Multi-provider support (OpenAI + Ollama).** Implemented on top of v0.4:

- `OpenAIProvider` — shared adapter using `openai` npm SDK for both OpenAI and
  Ollama. Ollama points at `http://localhost:11434/v1` via `baseUrl` config.
- Mapper functions — `toOpenAIMessages()`, `toOpenAITools()`, `mapOpenAIStopReason()`
  convert canonical types to OpenAI format. Pure, no I/O.
- Streaming — iterates SSE chunks, buffers tool-call arguments by index, yields
  `ChatChunk` events. Abort signal wired via `stream.controller.abort()`.
- Tool-call buffering — accumulates `delta.tool_calls[i].function.arguments` JSON
  fragments, parses on `finish_reason`. Handles multiple parallel tool calls.
- Ollama differences — handled in config, not code: fake `apiKey: "ollama"`,
  `/v1` baseUrl suffix, no `stream_options` sent (Ollama rejects unknown fields).
- Provider factory — `createProvider()` constructs `OpenAIProvider` for both
  `"openai"` and `"ollama"` cases with different config.
- Config defaults — `openai: { apiKeyEnv: "OPENAI_API_KEY" }`,
  `ollama: { baseUrl: "http://localhost:11434/v1" }`.
- Model defaults — OpenAI: `gpt-4o`, Ollama: `llama3.1` (configurable).
- Tests — mapper unit tests (14), provider tests (4), registry factory tests (2).
  Total: 20 new tests.
```

- [ ] **Step 2: Update roadmap section**

In the roadmap section, remove v0.5 from future and add v0.6:

```markdown
Roadmap (see `.claude/plans/snappy-dreaming-papert.md`):

- v0.6 Web tools, task tools, session resume.
```

- [ ] **Step 3: Update Provider Architecture section**

Find the "When Adding a New Provider" section and update to reflect shared adapter pattern:

```markdown
## When Adding a New Provider

1. Create `src/providers/<id>/{provider,mapper}.ts`.
2. `provider.ts` implements `LLMProvider`.
3. `mapper.ts` translates canonical types to provider-specific shapes.
4. Add the case to `createProvider` in `src/providers/registry.ts`.
5. Update `ProviderIdSchema` in `src/config/schema.ts`.
6. Update `ProviderId` type in `src/config/types.ts`.

**Shared adapters:** If the new provider is OpenAI-compatible (like Ollama),
reuse `OpenAIProvider` with different config instead of creating a new adapter.
Set `id: "ollama"` to enable provider-specific behavior (e.g., skip `stream_options`).
```

- [ ] **Step 4: Update repository layout**

In the repository layout section, add the openai directory:

```markdown
├── providers/            LLM provider abstraction + adapters.
│   ├── anthropic/        Anthropic SDK adapter (mapper + provider).
│   └── openai/           OpenAI / Ollama adapter (mapper + provider).
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm typecheck && pnpm build`

Expected: No errors.

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with v0.5 multi-provider status"
```

---

## Task 6: Update Library Entry Point (src/index.ts)

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add OpenAI provider re-exports**

Open `src/index.ts` and add after the Anthropic re-exports:

```typescript
// OpenAI / Ollama provider
export { OpenAIProvider, type OpenAIProviderConfig } from "./providers/openai/provider.js";
export {
  toOpenAIMessages,
  toOpenAITools,
  mapOpenAIStopReason,
} from "./providers/openai/mapper.js";
```

- [ ] **Step 2: Verify typecheck and build**

Run: `pnpm typecheck && pnpm build`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: re-export OpenAI provider from library entry point"
```

---

## Task 7: Final Verification + Cleanup

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`

Expected: All tests PASS (existing + 20 new provider tests).

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: No errors.

- [ ] **Step 3: Run build**

Run: `pnpm build`

Expected: Build succeeds, `dist/cli.js` + `dist/index.js` generated.

- [ ] **Step 4: Run linter**

Run: `pnpm lint`

Expected: No errors or warnings.

- [ ] **Step 5: Manual smoke test (optional, requires API keys)**

If you have `OPENAI_API_KEY` set:

```bash
node dist/cli.js run -p "Say hello in one sentence" --provider openai --model gpt-4o
```

Expected: Streaming response from OpenAI.

If you have Ollama running locally (`ollama serve` + `ollama pull llama3.1`):

```bash
node dist/cli.js run -p "Say hello in one sentence" --provider ollama --model llama3.1
```

Expected: Streaming response from local Ollama.

- [ ] **Step 6: Final commit (if any cleanup needed)**

```bash
git add -A
git status
git commit -m "chore: final cleanup for v0.5 multi-provider support"
```

---

## Summary

**Total tasks:** 7  
**Total new tests:** 20 (14 mapper + 4 provider + 2 registry)  
**Files created:** 4 (mapper.ts, provider.ts, mapper.test.ts, provider.test.ts)  
**Files modified:** 5 (package.json, defaults.ts, registry.ts, index.ts, CLAUDE.md)  

**Execution order:**
1. Task 1: Dependency + defaults (2 min)
2. Task 2: Mapper (10 min)
3. Task 3: Provider (15 min)
4. Task 4: Factory wiring (5 min)
5. Task 5: Docs (3 min)
6. Task 6: Library exports (2 min)
7. Task 7: Verification (3 min)

**Total estimated time:** ~40 minutes

**Ready for execution via Subagent-Driven Development.**
