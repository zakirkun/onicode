/**
 * MCP tool adapter.
 *
 * Converts an MCP SDK tool definition into an OniCode `Tool<unknown, unknown>`
 * instance. This allows tools discovered from MCP servers to be registered in
 * the OniCode tool registry and invoked by agents.
 *
 * The adapter wraps the MCP client's `callTool` method, handling content
 * extraction and error conversion. All MCP tools are marked as destructive
 * by default to ensure they go through the permission gate.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool, ToolExecCtx, JSONSchema } from "../tools/types.js";
import { ToolExecutionError } from "../tools/errors.js";

/**
 * Prefix used for all MCP tool names. Format: `mcp:<serverName>:<toolName>`.
 */
export const MCP_TOOL_NAME_PREFIX = "mcp:";

/**
 * MCP tool definition shape as returned by `listTools()`.
 */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
  };
}

/**
 * Adapt an MCP tool into an OniCode Tool.
 *
 * @param mcpTool - The MCP tool definition from `listTools()`.
 * @param serverName - The server nickname (e.g. "filesystem", "github").
 * @param client - The connected MCP Client instance.
 * @returns An OniCode Tool that delegates execution to the MCP client.
 */
export function adaptMcpTool(
  mcpTool: McpToolDefinition,
  serverName: string,
  client: Client,
): Tool<unknown, unknown> {
  const toolName = `${MCP_TOOL_NAME_PREFIX}${serverName}:${mcpTool.name}`;
  const description =
    mcpTool.description ?? `MCP tool from ${serverName} server`;

  return {
    name: toolName,
    description,
    inputSchema: mcpTool.inputSchema as JSONSchema,
    destructive: true,
    source: "mcp",

    summarize(input: unknown): string {
      const obj = input as Record<string, unknown> | null | undefined;
      if (!obj || typeof obj !== "object") {
        return toolName;
      }

      const firstKey = Object.keys(obj)[0];
      if (firstKey === undefined) {
        return toolName;
      }

      const firstValue = obj[firstKey];
      const valueStr =
        typeof firstValue === "string"
          ? firstValue
          : JSON.stringify(firstValue);

      const truncated =
        valueStr.length > 80 ? valueStr.slice(0, 80) + "..." : valueStr;

      return `${toolName}(${truncated})`;
    },

    async execute(input: unknown, _ctx: ToolExecCtx): Promise<unknown> {
      const result = await client.callTool({
        name: mcpTool.name,
        arguments: input as Record<string, unknown>,
      });

      const textBlocks: string[] = [];
      if (Array.isArray(result.content)) {
        for (const block of result.content) {
          if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "text" &&
            "text" in block &&
            typeof block.text === "string"
          ) {
            textBlocks.push(block.text);
          }
        }
      }

      const textOutput =
        textBlocks.length > 0 ? textBlocks.join("\n") : JSON.stringify(result);

      if (result.isError === true) {
        throw new ToolExecutionError(`MCP tool error: ${textOutput}`);
      }

      return textOutput;
    },
  };
}
