/**
 * Slash command registry tests.
 */
import { describe, it, expect, vi } from "vitest";
import {
  findCommand,
  parseSlashCommand,
  SLASH_COMMANDS,
} from "../../src/tui/slashCommands.js";
import type { SlashCommandContext } from "../../src/tui/slashCommands.js";
import type { RuntimeConfigManager } from "../../src/core/config/runtimeConfig.js";
import type { McpManager } from "../../src/core/mcp/manager.js";

/** Build a mock RuntimeConfigManager. */
function mockConfigManager(
  overrides?: Partial<{ defaultModel: string; defaultProvider: string }>,
): RuntimeConfigManager {
  return {
    current: {
      defaultModel: overrides?.defaultModel ?? "claude-sonnet-4-20250514",
      defaultProvider: overrides?.defaultProvider ?? "anthropic",
    },
    setModel: vi.fn(),
    setProvider: vi.fn(),
  } as unknown as RuntimeConfigManager;
}

/** Build a mock McpManager. */
function mockMcpManager(): McpManager {
  return {
    listServers: vi.fn().mockReturnValue([]),
    connectRuntimeServer: vi.fn().mockResolvedValue(undefined),
    disconnectRuntimeServer: vi.fn().mockResolvedValue(undefined),
  } as unknown as McpManager;
}

/** Build a minimal mock context for command execution. */
function mockCtx(
  overrides?: Partial<SlashCommandContext>,
): SlashCommandContext {
  return {
    permissionContext: { mode: "default", allow: [], deny: [] },
    registry: {
      manifests: () => [{ name: "Read", description: "Read a file" }],
    } as any,
    sessionFilePath: "/tmp/test.jsonl",
    agentId: "agent-test",
    modelId: "claude-3",
    providerId: "anthropic",
    configManager: mockConfigManager(),
    mcpManager: mockMcpManager(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findCommand
// ---------------------------------------------------------------------------
describe("findCommand", () => {
  it.each(["help", "exit", "mode", "tools", "session", "clear", "model", "provider"] as const)(
    "finds command by name: %s",
    (name) => {
      const cmd = findCommand(name);
      expect(cmd).toBeDefined();
      expect(cmd!.name).toBe(name);
    },
  );

  it("finds help by alias '?'", () => {
    const cmd = findCommand("?");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("help");
  });

  it("finds exit by alias 'quit'", () => {
    const cmd = findCommand("quit");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("exit");
  });

  it("finds exit by alias 'q'", () => {
    const cmd = findCommand("q");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("exit");
  });

  it("is case-insensitive", () => {
    expect(findCommand("HELP")!.name).toBe("help");
    expect(findCommand("Exit")!.name).toBe("exit");
    expect(findCommand("MODE")!.name).toBe("mode");
  });

  it("returns undefined for unknown command", () => {
    expect(findCommand("nonexistent")).toBeUndefined();
    expect(findCommand("foo")).toBeUndefined();
    expect(findCommand("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseSlashCommand
// ---------------------------------------------------------------------------
describe("parseSlashCommand", () => {
  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello")).toBeNull();
    expect(parseSlashCommand("not a command")).toBeNull();
  });

  it("parses /help with no args", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" });
  });

  it("parses /mode plan", () => {
    expect(parseSlashCommand("/mode plan")).toEqual({
      name: "mode",
      args: "plan",
    });
  });

  it("trims leading whitespace before the slash", () => {
    expect(parseSlashCommand("  /help")).toEqual({ name: "help", args: "" });
  });

  it("preserves extra spaces in args after the first space", () => {
    // /mode  plan → name: "mode", args: " plan"
    // After slicing past the first space, the rest is " plan"
    const result = parseSlashCommand("/mode  plan");
    expect(result).toEqual({ name: "mode", args: " plan" });
  });

  it("handles bare slash as empty name and empty args", () => {
    expect(parseSlashCommand("/")).toEqual({ name: "", args: "" });
  });

  it("returns null for empty string", () => {
    expect(parseSlashCommand("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------
describe("command execution", () => {
  it("help returns messages containing 'Slash commands'", () => {
    const cmd = findCommand("help")!;
    const result = cmd.execute("", mockCtx()) as { messages?: string[] };
    expect(result.messages).toBeDefined();
    expect(result.messages!.length).toBeGreaterThan(0);
    expect(result.messages!.join("\n")).toContain("Slash commands");
  });

  it("exit returns { exit: true }", () => {
    const cmd = findCommand("exit")!;
    const result = cmd.execute("", mockCtx());
    expect(result).toEqual({ exit: true });
  });

  it("quit alias returns { exit: true }", () => {
    const cmd = findCommand("quit")!;
    const result = cmd.execute("", mockCtx());
    expect(result).toEqual({ exit: true });
  });

  it("mode with empty args shows current mode", () => {
    const cmd = findCommand("mode")!;
    const ctx = mockCtx();
    const result = cmd.execute("", ctx) as { messages?: string[] };
    expect(result.messages).toBeDefined();
    const text = result.messages!.join("\n");
    expect(text).toContain("default");
  });

  it("mode 'plan' mutates ctx.permissionContext.mode", () => {
    const cmd = findCommand("mode")!;
    const ctx = mockCtx();
    const result = cmd.execute("plan", ctx) as { messages?: string[] };
    expect(ctx.permissionContext.mode).toBe("plan");
    expect(result.messages).toBeDefined();
    expect(result.messages!.join("\n")).toContain("plan");
  });

  it("mode with invalid value shows error and does not change mode", () => {
    const cmd = findCommand("mode")!;
    const ctx = mockCtx();
    const result = cmd.execute("invalid", ctx) as { messages?: string[] };
    expect(ctx.permissionContext.mode).toBe("default");
    expect(result.messages).toBeDefined();
    expect(result.messages!.join("\n")).toContain("Unknown mode");
  });

  it("tools lists tools from registry mock", () => {
    const cmd = findCommand("tools")!;
    const ctx = mockCtx();
    const result = cmd.execute("", ctx) as { messages?: string[] };
    expect(result.messages).toBeDefined();
    const text = result.messages!.join("\n");
    expect(text).toContain("Read");
  });

  it("session shows sessionFilePath, agentId, providerId, modelId", () => {
    const cmd = findCommand("session")!;
    const ctx = mockCtx();
    const result = cmd.execute("", ctx) as { messages?: string[] };
    expect(result.messages).toBeDefined();
    const text = result.messages!.join("\n");
    expect(text).toContain("/tmp/test.jsonl");
    expect(text).toContain("agent-test");
    expect(text).toContain("anthropic");
    expect(text).toContain("claude-3");
  });

  it("clear returns empty messages array", () => {
    const cmd = findCommand("clear")!;
    const result = cmd.execute("", mockCtx()) as { messages?: string[] };
    expect(result.messages).toBeDefined();
    expect(result.messages!).toEqual([]);
  });

  // ---- /model ---------------------------------------------------------------
  describe("/model", () => {
    it("finds command by name", () => {
      expect(findCommand("model")).toBeDefined();
      expect(findCommand("model")!.name).toBe("model");
    });

    it("shows current model with no args", () => {
      const cm = mockConfigManager({ defaultModel: "claude-opus-4-20250514" });
      const ctx = mockCtx({ configManager: cm });
      const result = findCommand("model")!.execute("", ctx) as { messages?: string[] };
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("claude-opus-4-20250514");
    });

    it("changes model when args provided", () => {
      const cm = mockConfigManager();
      const ctx = mockCtx({ configManager: cm });
      const result = findCommand("model")!.execute("gpt-4o", ctx) as { messages?: string[] };
      expect(cm.setModel).toHaveBeenCalledWith("gpt-4o");
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("gpt-4o");
    });

    it("trims whitespace from model arg", () => {
      const cm = mockConfigManager();
      const ctx = mockCtx({ configManager: cm });
      findCommand("model")!.execute("  gpt-4o  ", ctx);
      expect(cm.setModel).toHaveBeenCalledWith("gpt-4o");
    });
  });

  // ---- /provider ------------------------------------------------------------
  describe("/provider", () => {
    it("finds command by name", () => {
      expect(findCommand("provider")).toBeDefined();
      expect(findCommand("provider")!.name).toBe("provider");
    });

    it("shows current provider with no args", () => {
      const cm = mockConfigManager({ defaultProvider: "openai" });
      const ctx = mockCtx({ configManager: cm });
      const result = findCommand("provider")!.execute("", ctx) as { messages?: string[] };
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("openai");
    });

    it("changes provider when valid id provided", () => {
      const cm = mockConfigManager();
      const ctx = mockCtx({ configManager: cm });
      const result = findCommand("provider")!.execute("openai", ctx) as { messages?: string[] };
      expect(cm.setProvider).toHaveBeenCalledWith("openai");
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("openai");
    });

    it("accepts all valid provider ids", () => {
      for (const pid of ["anthropic", "openai", "ollama"]) {
        const cm = mockConfigManager();
        const ctx = mockCtx({ configManager: cm });
        findCommand("provider")!.execute(pid, ctx);
        expect(cm.setProvider).toHaveBeenCalledWith(pid);
      }
    });

    it("rejects unknown provider", () => {
      const cm = mockConfigManager();
      const ctx = mockCtx({ configManager: cm });
      const result = findCommand("provider")!.execute("gemini", ctx) as { messages?: string[] };
      expect(cm.setProvider).not.toHaveBeenCalled();
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("Unknown provider");
    });
  });

  // ---- /mcp-list ------------------------------------------------------------
  describe("/mcp-list", () => {
    it("finds command by name", () => {
      expect(findCommand("mcp-list")).toBeDefined();
      expect(findCommand("mcp-list")!.name).toBe("mcp-list");
    });

    it("shows message when no servers connected", () => {
      const mm = mockMcpManager();
      const ctx = mockCtx({ mcpManager: mm });
      const result = findCommand("mcp-list")!.execute("", ctx) as { messages?: string[] };
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("No MCP servers connected");
    });

    it("lists connected servers", () => {
      const mm = mockMcpManager();
      (mm.listServers as any).mockReturnValue([
        { name: "fs", connected: true, toolCount: 3 },
        { name: "db", connected: true, toolCount: 5 },
      ]);
      const ctx = mockCtx({ mcpManager: mm });
      const result = findCommand("mcp-list")!.execute("", ctx) as { messages?: string[] };
      expect(result.messages).toBeDefined();
      const text = result.messages!.join("\n");
      expect(text).toContain("fs");
      expect(text).toContain("db");
      expect(text).toContain("3 tools");
      expect(text).toContain("5 tools");
    });
  });

  // ---- /mcp-add -------------------------------------------------------------
  describe("/mcp-add", () => {
    it("finds command by name", () => {
      expect(findCommand("mcp-add")).toBeDefined();
      expect(findCommand("mcp-add")!.name).toBe("mcp-add");
    });

    it("shows usage when args missing", async () => {
      const mm = mockMcpManager();
      const ctx = mockCtx({ mcpManager: mm });
      const result = (await findCommand("mcp-add")!.execute("", ctx)) as { messages?: string[] };
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("Usage:");
      expect(mm.connectRuntimeServer).not.toHaveBeenCalled();
    });

    it("connects server with command and args", async () => {
      const mm = mockMcpManager();
      const ctx = mockCtx({ mcpManager: mm });
      const result = (await findCommand("mcp-add")!.execute(
        "fs npx -y @modelcontextprotocol/server-filesystem",
        ctx,
      )) as { messages?: string[] };
      expect(mm.connectRuntimeServer).toHaveBeenCalledWith(
        "fs",
        { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] },
        expect.anything(),
      );
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("connected");
    });

    it("shows error when connection fails", async () => {
      const mm = mockMcpManager();
      (mm.connectRuntimeServer as any).mockRejectedValue(new Error("spawn failed"));
      const ctx = mockCtx({ mcpManager: mm });
      const result = (await findCommand("mcp-add")!.execute("fs npx", ctx)) as { messages?: string[] };
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("Failed to connect");
      expect(result.messages!.join("\n")).toContain("spawn failed");
    });
  });

  // ---- /mcp-remove ----------------------------------------------------------
  describe("/mcp-remove", () => {
    it("finds command by name", () => {
      expect(findCommand("mcp-remove")).toBeDefined();
      expect(findCommand("mcp-remove")!.name).toBe("mcp-remove");
    });

    it("shows usage when name missing", async () => {
      const mm = mockMcpManager();
      const ctx = mockCtx({ mcpManager: mm });
      const result = (await findCommand("mcp-remove")!.execute("", ctx)) as { messages?: string[] };
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("Usage:");
      expect(mm.disconnectRuntimeServer).not.toHaveBeenCalled();
    });

    it("disconnects server by name", async () => {
      const mm = mockMcpManager();
      const ctx = mockCtx({ mcpManager: mm });
      const result = (await findCommand("mcp-remove")!.execute("fs", ctx)) as { messages?: string[] };
      expect(mm.disconnectRuntimeServer).toHaveBeenCalledWith("fs");
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("disconnected");
    });

    it("shows error when disconnection fails", async () => {
      const mm = mockMcpManager();
      (mm.disconnectRuntimeServer as any).mockRejectedValue(new Error("not connected"));
      const ctx = mockCtx({ mcpManager: mm });
      const result = (await findCommand("mcp-remove")!.execute("fs", ctx)) as { messages?: string[] };
      expect(result.messages).toBeDefined();
      expect(result.messages!.join("\n")).toContain("Failed to disconnect");
      expect(result.messages!.join("\n")).toContain("not connected");
    });
  });
});

// ---------------------------------------------------------------------------
// SLASH_COMMANDS structure
// ---------------------------------------------------------------------------
describe("SLASH_COMMANDS", () => {
  it("contains exactly 11 commands", () => {
    expect(SLASH_COMMANDS).toHaveLength(11);
  });

  it.each(SLASH_COMMANDS.map((c) => [c.name, c]))(
    "command '%s' has name, summary, and execute",
    (_name, cmd) => {
      expect(cmd.name).toBeTruthy();
      expect(cmd.summary).toBeTruthy();
      expect(typeof cmd.execute).toBe("function");
    },
  );
});
