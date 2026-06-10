/**
 * Tests for MCP client manager.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpManager } from "../../../src/core/mcp/manager.js";
import { NULL_LOGGER } from "../../../src/utils/logger.js";
import type { McpServerConfig } from "../../../src/config/types.js";

// Mock the MCP SDK Client and StdioClientTransport
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  const Client = vi.fn();
  Client.prototype.connect = vi.fn().mockResolvedValue(undefined);
  Client.prototype.listTools = vi.fn().mockResolvedValue({ tools: [] });
  Client.prototype.close = vi.fn().mockResolvedValue(undefined);
  return { Client };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  const StdioClientTransport = vi.fn();
  StdioClientTransport.prototype.pid = 12345;
  return { StdioClientTransport };
});

describe("McpManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initializeAll", () => {
    it("returns empty registry when mcpServers is empty", async () => {
      const manager = new McpManager({}, NULL_LOGGER);
      const registry = await manager.initializeAll();

      expect(registry.size()).toBe(0);
    });

    it("registers tools from a single server with correct namespacing", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      const mockTools = [
        {
          name: "readFile",
          description: "Read a file",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
        {
          name: "writeFile",
          description: "Write a file",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ];

      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: mockTools as never,
      });

      const config: Record<string, McpServerConfig> = {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
        },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      const registry = await manager.initializeAll();

      expect(registry.size()).toBe(2);
      expect(registry.has("mcp:filesystem:readFile")).toBe(true);
      expect(registry.has("mcp:filesystem:writeFile")).toBe(true);
    });

    it("skips server when spawn fails and continues with others", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      const warnSpy = vi.spyOn(NULL_LOGGER, "warn");

      // First server fails
      vi.mocked(Client.prototype.connect).mockRejectedValueOnce(
        new Error("spawn failed"),
      );

      // Second server succeeds
      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [
          {
            name: "tool1",
            description: "Tool 1",
            inputSchema: { type: "object" },
          },
        ] as never,
      });

      const config: Record<string, McpServerConfig> = {
        broken: { command: "broken-command" },
        working: { command: "working-command" },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      const registry = await manager.initializeAll();

      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to initialize MCP server",
        expect.objectContaining({ server: "broken" }),
      );
      expect(registry.size()).toBe(1);
      expect(registry.has("mcp:working:tool1")).toBe(true);
    });

    it("skips server when listTools fails and continues with others", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      const warnSpy = vi.spyOn(NULL_LOGGER, "warn");

      // First server: listTools fails
      vi.mocked(Client.prototype.listTools).mockRejectedValueOnce(
        new Error("listTools failed"),
      );

      // Second server: listTools succeeds
      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [
          {
            name: "tool2",
            description: "Tool 2",
            inputSchema: { type: "object" },
          },
        ] as never,
      });

      const config: Record<string, McpServerConfig> = {
        server1: { command: "cmd1" },
        server2: { command: "cmd2" },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      const registry = await manager.initializeAll();

      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to initialize MCP server",
        expect.objectContaining({ server: "server1" }),
      );
      expect(registry.size()).toBe(1);
      expect(registry.has("mcp:server2:tool2")).toBe(true);
    });

    it("registers tools from multiple servers", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      // Server 1: 2 tools
      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [
          { name: "tool1a", description: "Tool 1A", inputSchema: { type: "object" } },
          { name: "tool1b", description: "Tool 1B", inputSchema: { type: "object" } },
        ] as never,
      });

      // Server 2: 1 tool
      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [
          { name: "tool2", description: "Tool 2", inputSchema: { type: "object" } },
        ] as never,
      });

      const config: Record<string, McpServerConfig> = {
        server1: { command: "cmd1" },
        server2: { command: "cmd2" },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      const registry = await manager.initializeAll();

      expect(registry.size()).toBe(3);
      expect(registry.has("mcp:server1:tool1a")).toBe(true);
      expect(registry.has("mcp:server1:tool1b")).toBe(true);
      expect(registry.has("mcp:server2:tool2")).toBe(true);
    });

    it("calls Client constructor with correct name and version", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [],
      });

      const config: Record<string, McpServerConfig> = {
        test: { command: "test-cmd" },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      await manager.initializeAll();

      expect(Client).toHaveBeenCalledWith({ name: "onicode", version: "0.4.0" });
    });

    it("calls connect with correct transport parameters", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );
      const { StdioClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/stdio.js"
      );

      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [],
      });

      const config: Record<string, McpServerConfig> = {
        test: {
          command: "npx",
          args: ["-y", "some-server"],
          env: { API_KEY: "test-key" },
        },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      await manager.initializeAll();

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: "npx",
        args: ["-y", "some-server"],
        env: { API_KEY: "test-key" },
      });
      expect(Client.prototype.connect).toHaveBeenCalled();
    });
  });

  describe("shutdown", () => {
    it("calls client.close() on all connected servers", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [],
      });

      const config: Record<string, McpServerConfig> = {
        server1: { command: "cmd1" },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      await manager.initializeAll();
      await manager.shutdown();

      expect(Client.prototype.close).toHaveBeenCalled();
    });

    it("handles errors during client.close() gracefully", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      const errorSpy = vi.spyOn(NULL_LOGGER, "error");

      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [],
      });
      vi.mocked(Client.prototype.close).mockRejectedValueOnce(
        new Error("close failed"),
      );

      const config: Record<string, McpServerConfig> = {
        server1: { command: "cmd1" },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      await manager.initializeAll();

      // Should not throw
      await expect(manager.shutdown()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        "Error closing MCP client",
        expect.objectContaining({ server: "server1" }),
      );
    });

    it("clears tracking state after shutdown", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [],
      });

      const config: Record<string, McpServerConfig> = {
        server1: { command: "cmd1" },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      await manager.initializeAll();
      await manager.shutdown();

      // Calling shutdown again should be a no-op (no servers tracked)
      vi.clearAllMocks();
      await manager.shutdown();

      expect(Client.prototype.close).not.toHaveBeenCalled();
    });
  });

  describe("tool namespacing", () => {
    it("namespaces tools correctly with mcp:<server>:<tool> format", async () => {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );

      vi.mocked(Client.prototype.listTools).mockResolvedValueOnce({
        tools: [
          {
            name: "createIssue",
            description: "Create an issue",
            inputSchema: { type: "object" },
          },
        ] as never,
      });

      const config: Record<string, McpServerConfig> = {
        github: { command: "github-server" },
      };

      const manager = new McpManager(config, NULL_LOGGER);
      const registry = await manager.initializeAll();

      expect(registry.has("mcp:github:createIssue")).toBe(true);
      const tool = registry.get("mcp:github:createIssue");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("mcp:github:createIssue");
    });
  });
});
