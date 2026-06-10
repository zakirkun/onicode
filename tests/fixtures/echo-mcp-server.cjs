#!/usr/bin/env node
/**
 * Minimal MCP echo server for smoke testing.
 * Speaks JSON-RPC 2.0 over stdio with one tool: "echo".
 */
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "echo-server", version: "0.1.0" },
      },
    });
  } else if (msg.method === "notifications/initialized") {
    // No response needed for notifications
  } else if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echoes the input back",
            inputSchema: {
              type: "object",
              properties: { message: { type: "string" } },
              required: ["message"],
            },
          },
        ],
      },
    });
  } else if (msg.method === "tools/call") {
    const toolName = msg.params?.name;
    const args = msg.params?.arguments || {};
    const echoText =
      toolName === "echo"
        ? `Echo: ${args.message || ""}`
        : `Unknown tool: ${toolName}`;

    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: echoText }],
        isError: false,
      },
    });
  }
});
