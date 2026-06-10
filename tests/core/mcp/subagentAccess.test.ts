/**
 * Integration tests: MCP tools flowing through skill compilation.
 *
 * Verifies that MCP tools registered in the parent registry are correctly
 * passed to sub-agents when the skill's `allowedTools` includes them.
 */
import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/core/tools/registry.js";
import { compileSkill } from "../../../src/core/skills/compiler.js";
import { adaptMcpTool } from "../../../src/core/mcp/adapter.js";
import { bashTool } from "../../../src/tools/builtin/bash.js";
import { readTool } from "../../../src/tools/builtin/read.js";

describe("MCP tools in sub-agent skill compilation", () => {
  const mockClient = {
    callTool: vi.fn(),
  };

  function buildParentRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    // Built-in tools
    registry.register(readTool);
    registry.register(bashTool);

    // MCP tools
    const mcpRead = adaptMcpTool(
      {
        name: "readFile",
        description: "Read a file via MCP",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      },
      "filesystem",
      mockClient as never,
    );
    const mcpWrite = adaptMcpTool(
      {
        name: "writeFile",
        description: "Write a file via MCP",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
      },
      "filesystem",
      mockClient as never,
    );

    registry.register(mcpRead);
    registry.register(mcpWrite);

    return registry;
  }

  it("includes MCP tools when allowedTools lists them by name", () => {
    const parentRegistry = buildParentRegistry();

    const result = compileSkill({
      skill: {
        name: "worker",
        description: "Worker skill",
        body: "You are a worker.",
        allowedTools: ["Read", "mcp:filesystem:readFile", "mcp:filesystem:writeFile"],
        source: { path: "/test/worker.skill.md", scope: "builtin" },
      },
      agentId: "agent-1",
      defaultModel: "claude-sonnet-4-20250514",
      defaultProviderId: "anthropic",
      parentRegistry,
    });

    expect(result.registry.size()).toBe(3);
    expect(result.registry.has("Read")).toBe(true);
    expect(result.registry.has("mcp:filesystem:readFile")).toBe(true);
    expect(result.registry.has("mcp:filesystem:writeFile")).toBe(true);
    // Bash was NOT in allowedTools
    expect(result.registry.has("Bash")).toBe(false);
  });

  it("excludes MCP tools when allowedTools does not list them", () => {
    const parentRegistry = buildParentRegistry();

    const result = compileSkill({
      skill: {
        name: "reader",
        description: "Reader skill",
        body: "You are a reader.",
        allowedTools: ["Read", "Bash"],
        source: { path: "/test/reader.skill.md", scope: "builtin" },
      },
      agentId: "agent-2",
      defaultModel: "claude-sonnet-4-20250514",
      defaultProviderId: "anthropic",
      parentRegistry,
    });

    expect(result.registry.size()).toBe(2);
    expect(result.registry.has("Read")).toBe(true);
    expect(result.registry.has("Bash")).toBe(true);
    expect(result.registry.has("mcp:filesystem:readFile")).toBe(false);
    expect(result.registry.has("mcp:filesystem:writeFile")).toBe(false);
  });

  it("inherits all tools (including MCP) when allowedTools is undefined", () => {
    const parentRegistry = buildParentRegistry();

    const result = compileSkill({
      skill: {
        name: "full",
        description: "Full access skill",
        body: "You have full access.",
        allowedTools: undefined,
        source: { path: "/test/full.skill.md", scope: "builtin" },
      },
      agentId: "agent-3",
      defaultModel: "claude-sonnet-4-20250514",
      defaultProviderId: "anthropic",
      parentRegistry,
    });

    // Should get the parent registry directly (all 4 tools)
    expect(result.registry).toBe(parentRegistry);
    expect(result.registry.has("mcp:filesystem:readFile")).toBe(true);
    expect(result.registry.has("mcp:filesystem:writeFile")).toBe(true);
  });

  it("silently ignores unknown MCP tool names in allowedTools", () => {
    const parentRegistry = buildParentRegistry();

    const result = compileSkill({
      skill: {
        name: "partial",
        description: "Partial skill",
        body: "Partial.",
        allowedTools: ["Read", "mcp:nonexistent:tool", "mcp:filesystem:readFile"],
        source: { path: "/test/partial.skill.md", scope: "builtin" },
      },
      agentId: "agent-4",
      defaultModel: "claude-sonnet-4-20250514",
      defaultProviderId: "anthropic",
      parentRegistry,
    });

    // Unknown name is silently dropped; only Read + mcp:filesystem:readFile remain
    expect(result.registry.size()).toBe(2);
    expect(result.registry.has("Read")).toBe(true);
    expect(result.registry.has("mcp:filesystem:readFile")).toBe(true);
  });
});
