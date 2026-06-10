import { describe, it, expect } from "vitest";
import {
  toAnthropicMessages,
  toAnthropicTools,
  mapStopReason,
} from "../../../src/providers/anthropic/mapper.js";
import type { ChatMessage } from "../../../src/providers/types.js";
import type { ToolManifest } from "../../../src/core/tools/types.js";

describe("toAnthropicMessages", () => {
  it("maps user message with text content", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);
  });

  it("maps assistant message with text content", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
    ]);
  });

  it("maps tool_use content block from assistant", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "call_1", name: "read_file", input: { path: "/tmp/x" } },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "call_1", name: "read_file", input: { path: "/tmp/x" } },
        ],
      },
    ]);
  });

  it("maps tool_result content block", () => {
    const messages: ChatMessage[] = [
      {
        role: "tool",
        content: [{ type: "tool_result", toolUseId: "call_1", content: "file content" }],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_1", content: "file content" },
        ],
      },
    ]);
  });

  it("maps tool_result with isError flag", () => {
    const messages: ChatMessage[] = [
      {
        role: "tool",
        content: [
          { type: "tool_result", toolUseId: "call_2", content: "not found", isError: true },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call_2", content: "not found", is_error: true },
        ],
      },
    ]);
  });

  it("maps tool_use with null/undefined input as empty object", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_3", name: "noop", input: null }],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_3", name: "noop", input: {} }],
      },
    ]);
  });

  it("drops system messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: [{ type: "text", text: "You are helpful" }] },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe("user");
  });

  it("returns empty array for empty input", () => {
    expect(toAnthropicMessages([])).toEqual([]);
  });

  it("returns empty array when all messages are system", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: [{ type: "text", text: "System 1" }] },
      { role: "system", content: [{ type: "text", text: "System 2" }] },
    ];
    expect(toAnthropicMessages(messages)).toEqual([]);
  });

  it("preserves multiple content blocks in a single message", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this" },
          { type: "text", text: "And this" },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this" },
          { type: "text", text: "And this" },
        ],
      },
    ]);
  });

  it("handles conversation with multiple turns", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi" }] },
      { role: "user", content: [{ type: "text", text: "How are you?" }] },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toHaveLength(3);
    expect(result[0]?.role).toBe("user");
    expect(result[1]?.role).toBe("assistant");
    expect(result[2]?.role).toBe("user");
  });

  it("maps mixed assistant message with text and tool_use", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me read that file." },
          { type: "tool_use", id: "call_5", name: "read_file", input: { path: "/a.txt" } },
        ],
      },
    ];
    const result = toAnthropicMessages(messages);
    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me read that file." },
          { type: "tool_use", id: "call_5", name: "read_file", input: { path: "/a.txt" } },
        ],
      },
    ]);
  });
});

describe("toAnthropicTools", () => {
  it("maps tool manifest to Anthropic tool format", () => {
    const manifests: ToolManifest[] = [
      {
        name: "read_file",
        description: "Read a file from disk",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
        source: "builtin",
      },
    ];
    const result = toAnthropicTools(manifests);
    expect(result).toEqual([
      {
        name: "read_file",
        description: "Read a file from disk",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ]);
  });

  it("returns empty array when no manifests", () => {
    expect(toAnthropicTools([])).toEqual([]);
  });

  it("maps multiple tool manifests", () => {
    const manifests: ToolManifest[] = [
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        source: "builtin",
      },
      {
        name: "write_file",
        description: "Write a file",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
        },
        source: "builtin",
      },
    ];
    const result = toAnthropicTools(manifests);
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("read_file");
    expect(result[1]?.name).toBe("write_file");
  });

  it("preserves inputSchema as-is", () => {
    const schema = {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command" },
        timeout: { type: "number" },
      },
      required: ["command"],
    };
    const manifests: ToolManifest[] = [
      { name: "bash", description: "Run shell", inputSchema: schema, source: "builtin" },
    ];
    const result = toAnthropicTools(manifests);
    expect(result[0]?.input_schema).toEqual(schema);
  });
});

describe("mapStopReason", () => {
  it('maps "end_turn" to "end_turn"', () => {
    expect(mapStopReason("end_turn")).toBe("end_turn");
  });

  it('maps "tool_use" to "tool_use"', () => {
    expect(mapStopReason("tool_use")).toBe("tool_use");
  });

  it('maps "max_tokens" to "max_tokens"', () => {
    expect(mapStopReason("max_tokens")).toBe("max_tokens");
  });

  it('maps "stop_sequence" to "stop_sequence"', () => {
    expect(mapStopReason("stop_sequence")).toBe("stop_sequence");
  });

  it("maps null to error", () => {
    expect(mapStopReason(null)).toBe("error");
  });

  it("maps undefined to error", () => {
    expect(mapStopReason(undefined)).toBe("error");
  });

  it("maps unknown string to error", () => {
    expect(mapStopReason("something_unknown")).toBe("error");
  });
});
