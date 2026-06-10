/**
 * Slash command registry tests.
 */
import { describe, it, expect } from "vitest";
import {
  findCommand,
  parseSlashCommand,
  SLASH_COMMANDS,
} from "../../src/tui/slashCommands.js";
import type { SlashCommandContext } from "../../src/tui/slashCommands.js";

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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findCommand
// ---------------------------------------------------------------------------
describe("findCommand", () => {
  it.each(["help", "exit", "mode", "tools", "session", "clear"] as const)(
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
});

// ---------------------------------------------------------------------------
// SLASH_COMMANDS structure
// ---------------------------------------------------------------------------
describe("SLASH_COMMANDS", () => {
  it("contains exactly 6 commands", () => {
    expect(SLASH_COMMANDS).toHaveLength(6);
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
