/**
 * CLI argument parser tests.
 *
 * Verifies that `parseArgs` correctly handles subcommand routing, option
 * parsing, flag defaults, and input validation for the OniCode CLI surface.
 */
import { describe, it, expect } from "vitest";
import { parseArgs, HELP_TEXT } from "../../src/cli/args.js";

// ─── Default values ──────────────────────────────────────────────────────

describe("parseArgs defaults", () => {
  it("returns chat command with debug false and help false for empty argv", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("chat");
    expect(result.debug).toBe(false);
    expect(result.help).toBe(false);
  });

  it("leaves optional fields undefined when not supplied", () => {
    const result = parseArgs([]);
    expect(result.prompt).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
    expect(result.mode).toBeUndefined();
    expect(result.provider).toBeUndefined();
    expect(result.model).toBeUndefined();
  });
});

// ─── Subcommand routing ──────────────────────────────────────────────────

describe("subcommand routing", () => {
  it('parses "run" as run command', () => {
    const result = parseArgs(["run"]);
    expect(result.command).toBe("run");
  });

  it('parses "chat" as chat command', () => {
    const result = parseArgs(["chat"]);
    expect(result.command).toBe("chat");
  });

  it('parses "skills" as skills command', () => {
    const result = parseArgs(["skills"]);
    expect(result.command).toBe("skills");
  });

  it('parses "help" as help command', () => {
    const result = parseArgs(["help"]);
    expect(result.command).toBe("help");
  });

  it('parses "resume" as resume command', () => {
    const result = parseArgs(["resume"]);
    expect(result.command).toBe("resume");
  });

  it("defaults to chat for unknown subcommand", () => {
    const result = parseArgs(["foobar"]);
    expect(result.command).toBe("chat");
  });

  it("defaults to chat when no positional is given", () => {
    const result = parseArgs(["--debug"]);
    expect(result.command).toBe("chat");
  });
});

// ─── Prompt option ───────────────────────────────────────────────────────

describe("prompt option", () => {
  it('parses -p "hello" as prompt "hello"', () => {
    const result = parseArgs(["-p", "hello"]);
    expect(result.prompt).toBe("hello");
  });

  it('parses --prompt "hello" as prompt "hello"', () => {
    const result = parseArgs(["--prompt", "hello"]);
    expect(result.prompt).toBe("hello");
  });
});

// ─── Mode option ─────────────────────────────────────────────────────────

describe("mode option", () => {
  it('parses --mode default', () => {
    const result = parseArgs(["--mode", "default"]);
    expect(result.mode).toBe("default");
  });

  it('parses --mode acceptEdits', () => {
    const result = parseArgs(["--mode", "acceptEdits"]);
    expect(result.mode).toBe("acceptEdits");
  });

  it('parses --mode plan', () => {
    const result = parseArgs(["--mode", "plan"]);
    expect(result.mode).toBe("plan");
  });

  it('parses --mode bypassPermissions', () => {
    const result = parseArgs(["--mode", "bypassPermissions"]);
    expect(result.mode).toBe("bypassPermissions");
  });

  it("throws on invalid mode", () => {
    expect(() => parseArgs(["--mode", "superuser"])).toThrowError(
      /Unknown mode "superuser"/,
    );
  });
});

// ─── Provider option ─────────────────────────────────────────────────────

describe("provider option", () => {
  it('parses --provider anthropic', () => {
    const result = parseArgs(["--provider", "anthropic"]);
    expect(result.provider).toBe("anthropic");
  });

  it('parses --provider openai', () => {
    const result = parseArgs(["--provider", "openai"]);
    expect(result.provider).toBe("openai");
  });

  it('parses --provider ollama', () => {
    const result = parseArgs(["--provider", "ollama"]);
    expect(result.provider).toBe("ollama");
  });

  it("throws on invalid provider", () => {
    expect(() => parseArgs(["--provider", "gemini"])).toThrowError(
      /Unknown provider "gemini"/,
    );
  });
});

// ─── Model option ────────────────────────────────────────────────────────

describe("model option", () => {
  it('parses --model claude-3', () => {
    const result = parseArgs(["--model", "claude-3"]);
    expect(result.model).toBe("claude-3");
  });
});

// ─── Debug flag ──────────────────────────────────────────────────────────

describe("debug flag", () => {
  it("sets debug to true when --debug is passed", () => {
    const result = parseArgs(["--debug"]);
    expect(result.debug).toBe(true);
  });
});

// ─── Help flag ───────────────────────────────────────────────────────────

describe("help flag", () => {
  it("sets help to true when -h is passed", () => {
    const result = parseArgs(["-h"]);
    expect(result.help).toBe(true);
  });

  it("sets help to true when --help is passed", () => {
    const result = parseArgs(["--help"]);
    expect(result.help).toBe(true);
  });
});

// ─── Resume with sessionId ───────────────────────────────────────────────

describe("resume command", () => {
  it("parses sessionId from second positional for resume", () => {
    const result = parseArgs(["resume", "sess123"]);
    expect(result.command).toBe("resume");
    expect(result.sessionId).toBe("sess123");
  });

  it("leaves sessionId undefined when resume has no second positional", () => {
    const result = parseArgs(["resume"]);
    expect(result.command).toBe("resume");
    expect(result.sessionId).toBeUndefined();
  });
});

// ─── Combined flags ──────────────────────────────────────────────────────

describe("combined flags", () => {
  it('parses run -p "test" --mode plan --debug', () => {
    const result = parseArgs(["run", "-p", "test", "--mode", "plan", "--debug"]);
    expect(result.command).toBe("run");
    expect(result.prompt).toBe("test");
    expect(result.mode).toBe("plan");
    expect(result.debug).toBe(true);
  });
});

// ─── HELP_TEXT constant ──────────────────────────────────────────────────

describe("HELP_TEXT", () => {
  it("is a non-empty string", () => {
    expect(typeof HELP_TEXT).toBe("string");
    expect(HELP_TEXT.length).toBeGreaterThan(0);
  });
});
