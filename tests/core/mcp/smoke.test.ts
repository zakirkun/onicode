/**
 * Smoke test: end-to-end MCP server spawn, tool discovery, and invocation.
 *
 * Uses the echo-mcp-server.js fixture to verify the full pipeline:
 *   McpManager → StdioClientTransport → connect → listTools → adaptMcpTool → execute
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpManager } from "../../../src/core/mcp/manager.js";
import { NULL_LOGGER } from "../../../src/utils/logger.js";
import type { McpServerConfig } from "../../../src/config/types.js";
import type { ToolExecCtx } from "../../../src/core/tools/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const echoServerPath = path.resolve(__dirname, "../../fixtures/echo-mcp-server.cjs");

describe("MCP smoke test (real server)", () => {
  it("spawns echo server, discovers tools, and invokes them", async () => {
    const config: Record<string, McpServerConfig> = {
      echo: {
        command: "node",
        args: [echoServerPath],
      },
    };

    const manager = new McpManager(config, NULL_LOGGER);

    // 1. Initialize: spawn + connect + listTools
    const registry = await manager.initializeAll();

    // 2. Verify tool discovery
    expect(registry.size()).toBe(1);
    expect(registry.has("mcp:echo:echo")).toBe(true);

    // 3. Verify tool properties
    const tool = registry.get("mcp:echo:echo");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("mcp:echo:echo");
    expect(tool?.description).toBe("Echoes the input back");
    expect(tool?.source).toBe("mcp");
    expect(tool?.destructive).toBe(true);

    // 4. Verify tool invocation
    const mockCtx: ToolExecCtx = {
      signal: new AbortController().signal,
      cwd: process.cwd(),
      log: NULL_LOGGER,
      agentId: "smoke-test",
      callId: "smoke-call",
    };

    const result = await tool!.execute({ message: "hello world" }, mockCtx);
    expect(result).toBe("Echo: hello world");

    // 5. Verify summarize
    const summary = tool!.summarize({ message: "hello world" });
    expect(summary).toBe("mcp:echo:echo(hello world)");

    // 6. Clean shutdown
    await manager.shutdown();
  });

  it("handles multiple servers simultaneously", async () => {
    // Two instances of the same echo server under different names
    const config: Record<string, McpServerConfig> = {
      echo1: {
        command: "node",
        args: [echoServerPath],
      },
      echo2: {
        command: "node",
        args: [echoServerPath],
      },
    };

    const manager = new McpManager(config, NULL_LOGGER);
    const registry = await manager.initializeAll();

    expect(registry.size()).toBe(2);
    expect(registry.has("mcp:echo1:echo")).toBe(true);
    expect(registry.has("mcp:echo2:echo")).toBe(true);

    await manager.shutdown();
  });
});
