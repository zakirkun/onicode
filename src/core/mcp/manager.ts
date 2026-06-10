/**
 * MCP client manager.
 *
 * Orchestrates the lifecycle of external MCP servers: spawns child processes
 * via the MCP SDK stdio transport, connects, discovers tools, adapts them into
 * OniCode {@link Tool} instances, and registers them in a {@link ToolRegistry}.
 *
 * The manager tracks every active connection so that {@link McpManager.shutdown}
 * can tear them all down gracefully — SIGTERM first, SIGKILL as a fallback.
 *
 * Servers that fail to spawn or whose tool listing errors are logged and
 * skipped; one broken server never blocks the rest.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServerConfig } from "../../config/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { adaptMcpTool } from "./adapter.js";
import type { McpToolDefinition } from "./adapter.js";
import type { Logger } from "../../utils/logger.js";

/** Tracked state for a single connected MCP server. */
interface ManagedServer {
  /** The connected MCP client. */
  client: Client;
  /** The stdio transport (owns the child process). */
  transport: StdioClientTransport;
  /** PID of the spawned child process, or null if unavailable. */
  pid: number | null;
  /** Number of tools discovered from this server. */
  toolCount: number;
}

/** Summary of a single MCP server for listing. */
export interface McpServerSummary {
  name: string;
  connected: boolean;
  toolCount: number;
}

/**
 * Manages MCP server connections and tool discovery.
 *
 * Usage:
 * ```ts
 * const manager = new McpManager(config.mcpServers, log);
 * const registry = await manager.initializeAll();
 * // ... use registry ...
 * await manager.shutdown();
 * ```
 */
export class McpManager {
  /** Active server connections, keyed by server nickname from config. */
  private readonly servers = new Map<string, ManagedServer>();

  constructor(
    private readonly mcpServers: Record<string, McpServerConfig>,
    private readonly log: Logger,
  ) {}

  /**
   * Spawn all configured MCP servers, connect, and list their tools.
   *
   * Returns a {@link ToolRegistry} containing every tool discovered across
   * all servers, namespaced as `mcp:<serverName>:<toolName>`. Servers that
   * fail to spawn or whose tool listing errors are logged and skipped —
   * one broken server never prevents the rest from loading.
   */
  async initializeAll(): Promise<ToolRegistry> {
    const registry = new ToolRegistry();

    for (const [serverName, serverConfig] of Object.entries(this.mcpServers)) {
      try {
        const managed = await this.connectServer(serverName, serverConfig);
        this.servers.set(serverName, managed);

        const { tools } = await managed.client.listTools();
        managed.toolCount = tools.length;

        for (const mcpTool of tools) {
          const adapted = adaptMcpTool(
            mcpTool as McpToolDefinition,
            serverName,
            managed.client,
          );
          registry.register(adapted);
        }

        this.log.info("MCP server connected", {
          server: serverName,
          toolCount: tools.length,
        });
      } catch (err) {
        this.log.warn("Failed to initialize MCP server", {
          server: serverName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return registry;
  }

  /**
   * List all known MCP servers with their connection status.
   */
  listServers(): McpServerSummary[] {
    return Array.from(this.servers.entries()).map(([name, managed]) => ({
      name,
      connected: true,
      toolCount: managed.toolCount,
    }));
  }

  /**
   * Connect a new MCP server at runtime.
   *
   * @param name - Server nickname for namespacing tools.
   * @param config - Server launch configuration.
   * @param registry - Tool registry to add discovered tools to.
   */
  async connectRuntimeServer(
    name: string,
    config: McpServerConfig,
    registry: ToolRegistry,
  ): Promise<void> {
    if (this.servers.has(name)) {
      throw new Error(`MCP server "${name}" is already connected.`);
    }

    const managed = await this.connectServer(name, config);
    this.servers.set(name, managed);

    const { tools } = await managed.client.listTools();
    managed.toolCount = tools.length;

    for (const mcpTool of tools) {
      const adapted = adaptMcpTool(
        mcpTool as McpToolDefinition,
        name,
        managed.client,
      );
      registry.register(adapted);
    }

    this.log.info("MCP server connected at runtime", {
      server: name,
      toolCount: tools.length,
    });
  }

  /**
   * Disconnect an MCP server at runtime.
   *
   * @param name - Server nickname to disconnect.
   */
  async disconnectRuntimeServer(name: string): Promise<void> {
    const managed = this.servers.get(name);
    if (!managed) {
      throw new Error(`MCP server "${name}" is not connected.`);
    }

    this.servers.delete(name);

    try {
      await managed.client.close();
    } catch (err) {
      this.log.error("Error closing MCP client", {
        server: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await this.killProcess(managed.pid, 3000);
    } catch (err) {
      this.log.error("Error killing MCP server process", {
        server: name,
        pid: managed.pid,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.log.info("MCP server disconnected", { server: name });
  }

  /**
   * Gracefully shut down all running MCP servers.
   *
   * For each tracked server: calls `client.close()` to send the disconnect
   * notification, then kills the child process with SIGTERM. If the process
   * does not exit within `timeoutMs` (default 3000), sends SIGKILL.
   *
   * Shutdown is best-effort — errors are logged but never thrown.
   *
   * @param timeoutMs - Milliseconds to wait after SIGTERM before SIGKILL.
   */
  async shutdown(timeoutMs = 3000): Promise<void> {
    const entries = Array.from(this.servers.entries());
    this.servers.clear();

    for (const [serverName, managed] of entries) {
      try {
        await managed.client.close();
      } catch (err) {
        this.log.error("Error closing MCP client", {
          server: serverName,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        await this.killProcess(managed.pid, timeoutMs);
      } catch (err) {
        this.log.error("Error killing MCP server process", {
          server: serverName,
          pid: managed.pid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Spawn a child process and connect to an MCP server via stdio transport.
   */
  private async connectServer(
    serverName: string,
    config: McpServerConfig,
  ): Promise<ManagedServer> {
    const params: { command: string; args: string[]; env?: Record<string, string> } = {
      command: config.command,
      args: config.args ?? [],
    };
    if (config.env !== undefined) {
      params.env = config.env;
    }
    const transport = new StdioClientTransport(params);

    const client = new Client({ name: "onicode", version: "0.4.0" });
    await client.connect(transport);

    const pid = transport.pid ?? null;

    this.log.debug("MCP server process spawned", { server: serverName, pid });

    return { client, transport, pid, toolCount: 0 };
  }

  /**
   * Kill a process by PID: SIGTERM first, SIGKILL after timeout.
   */
  private killProcess(
    pid: number | null,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      if (pid === null) {
        resolve();
        return;
      }

      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process already exited — nothing to do.
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Process already exited.
        }
        resolve();
      }, timeoutMs);

      // Allow the event loop to exit even if the timer is pending.
      timer.unref();
    });
  }
}
