import { describe, it, expect } from "vitest";
import { toOpenAIMessages, toOpenAITools, mapOpenAIStopReason } from "../../../src/providers/openai/mapper.js";
import type { ChatMessage } from "../../../src/providers/types.js";
import type { ToolManifest } from "../../../src/core/tools/types.js";

describe("toOpenAIMessages", () => {
  it("maps user message with text content", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("maps assistant message", () => {
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

describe("toOpenAITools", () => {
  it("maps tool definition to OpenAI function format", () => {
    const tools: ToolManifest[] = [
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        source: "builtin",
      },
    ];
    const result = toOpenAITools(tools);
    expect(result).toEqual([
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      },
    ]);
  });

  it("returns empty array when no tools", () => {
    const result = toOpenAITools([]);
    expect(result).toEqual([]);
  });

  it("maps multiple tools", () => {
    const tools: ToolManifest[] = [
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        source: "builtin",
      },
      {
        name: "write_file",
        description: "Write a file",
        inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } },
        source: "builtin",
      },
    ];
    const result = toOpenAITools(tools);
    expect(result).toHaveLength(2);
    expect(result[0]?.function.name).toBe("read_file");
    expect(result[1]?.function.name).toBe("write_file");
  });
});

describe("mapOpenAIStopReason", () => {
  it('maps "stop" to "end_turn"', () => {
    expect(mapOpenAIStopReason("stop")).toBe("end_turn");
  });

  it('maps "tool_calls" to "tool_use"', () => {
    expect(mapOpenAIStopReason("tool_calls")).toBe("tool_use");
  });

  it('maps "length" to "max_tokens"', () => {
    expect(mapOpenAIStopReason("length")).toBe("max_tokens");
  });

  it('maps "content_filter" to "stop_sequence"', () => {
    expect(mapOpenAIStopReason("content_filter")).toBe("stop_sequence");
  });

  it("maps null to error", () => {
    expect(mapOpenAIStopReason(null)).toBe("error");
  });

  it("maps unknown string to error", () => {
    expect(mapOpenAIStopReason("something_else")).toBe("error");
  });
});
