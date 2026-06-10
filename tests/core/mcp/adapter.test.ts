/**
 * Tests for MCP tool adapter.
 */
import { describe, it, expect, vi } from "vitest";
import { adaptMcpTool, MCP_TOOL_NAME_PREFIX } from "../../../src/core/mcp/adapter.js";
import { ToolExecutionError } from "../../../src/core/tools/errors.js";
import type { ToolExecCtx } from "../../../src/core/tools/types.js";

describe("adaptMcpTool", () => {
  const mockClient = {
    callTool: vi.fn(),
  };

  const mockCtx: ToolExecCtx = {
    signal: new AbortController().signal,
    cwd: "/test",
    log: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    } as unknown as ToolExecCtx["log"],
    agentId: "test-agent",
    callId: "test-call",
  };

  const mcpTool = {
    name: "testTool",
    description: "A test tool",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string" },
        count: { type: "number" },
      },
      required: ["path"],
    },
  };

  it("creates tool with correct name", () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    expect(tool.name).toBe("mcp:testServer:testTool");
  });

  it("uses description from MCP tool", () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    expect(tool.description).toBe("A test tool");
  });

  it("provides fallback description when MCP tool has no description", () => {
    const toolNoDesc = { ...mcpTool, description: undefined };
    const tool = adaptMcpTool(toolNoDesc, "testServer", mockClient as never);
    expect(tool.description).toBe("MCP tool from testServer server");
  });

  it("passes through inputSchema correctly", () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    expect(tool.inputSchema).toEqual(mcpTool.inputSchema);
  });

  it("sets destructive to true", () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    expect(tool.destructive).toBe(true);
  });

  it("sets source to 'mcp'", () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    expect(tool.source).toBe("mcp");
  });

  it("summarize produces correct format with first argument", () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    const summary = tool.summarize({ path: "/home/user/file.txt", count: 5 });
    expect(summary).toBe("mcp:testServer:testTool(/home/user/file.txt)");
  });

  it("summarize truncates long values to 80 chars", () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    const longPath = "a".repeat(100);
    const summary = tool.summarize({ path: longPath });
    // 80 chars of value + "..." + tool name prefix
    expect(summary).toBe(`mcp:testServer:testTool(${"a".repeat(80)}...)`);
    expect(summary).toContain("...");
  });

  it("summarize handles empty input", () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    const summary = tool.summarize({});
    expect(summary).toBe("mcp:testServer:testTool");
  });

  it("execute calls client.callTool with correct args", async () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    const input = { path: "/test/file.txt" };

    mockClient.callTool.mockResolvedValueOnce({
      content: [{ type: "text", text: "result" }],
      isError: false,
    });

    await tool.execute(input, mockCtx);

    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: "testTool",
      arguments: input,
    });
  });

  it("execute extracts text content from result", async () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);

    mockClient.callTool.mockResolvedValueOnce({
      content: [
        { type: "text", text: "line 1" },
        { type: "text", text: "line 2" },
      ],
      isError: false,
    });

    const result = await tool.execute({}, mockCtx);
    expect(result).toBe("line 1\nline 2");
  });

  it("execute throws ToolExecutionError on isError", async () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);

    mockClient.callTool.mockResolvedValue({
      content: [{ type: "text", text: "error message" }],
      isError: true,
    });

    await expect(tool.execute({}, mockCtx)).rejects.toThrow(ToolExecutionError);
    await expect(tool.execute({}, mockCtx)).rejects.toThrow(
      "MCP tool error: error message",
    );
  });

  it("execute handles empty content blocks", async () => {
    const tool = adaptMcpTool(mcpTool, "testServer", mockClient as never);
    const fullResult = {
      content: [],
      structuredContent: { data: "value" },
      isError: false,
    };

    mockClient.callTool.mockResolvedValueOnce(fullResult);

    const result = await tool.execute({}, mockCtx);
    expect(result).toBe(JSON.stringify(fullResult));
  });

  it("MCP_TOOL_NAME_PREFIX is exported correctly", () => {
    expect(MCP_TOOL_NAME_PREFIX).toBe("mcp:");
  });
});
