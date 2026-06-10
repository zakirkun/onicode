import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionWriter } from "../../../src/core/session/writer.js";
import type { SessionMeta, SessionEntry } from "../../../src/core/session/types.js";
import { NULL_LOGGER } from "../../../src/utils/logger.js";

/** Create a fresh temporary directory before each test and remove it after. */
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "onicode-session-writer-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Helper: build a minimal SessionMeta. */
function testMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "ses_test123",
    createdAt: "2026-06-10T00:00:00.000Z",
    cwd: "/tmp/workdir",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    version: "0.5.0",
    ...overrides,
  };
}

/** Helper: read and parse all JSONL lines from a file. */
async function readJsonl(filePath: string): Promise<SessionEntry[]> {
  const content = await readFile(filePath, "utf8");
  // Filter out empty lines (trailing newline produces one).
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  return lines.map((line) => JSON.parse(line) as SessionEntry);
}

// Regex for a valid ISO 8601 date-time string.
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe("SessionWriter", () => {
  // -----------------------------------------------------------------------
  // File creation & session_start
  // -----------------------------------------------------------------------
  describe("file creation and session_start", () => {
    it("creates the JSONL file with a session_start entry on start()", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.start(testMeta());

      const entries = await readJsonl(filePath);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe("session_start");
    });

    it("session_start entry contains the provided meta", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });
      const meta = testMeta({ id: "ses_abc", model: "gpt-4o" });

      await writer.start(meta);

      const entries = await readJsonl(filePath);
      const entry = entries[0]! as SessionEntry & { kind: "session_start" };
      expect(entry.meta.id).toBe("ses_abc");
      expect(entry.meta.model).toBe("gpt-4o");
    });

    it("session_start entry has id and ts fields", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.start(testMeta());

      const entries = await readJsonl(filePath);
      const entry = entries[0]!;
      expect(entry.id).toBeDefined();
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);
      expect(entry.ts).toMatch(ISO_8601_RE);
    });
  });

  // -----------------------------------------------------------------------
  // JSONL append semantics
  // -----------------------------------------------------------------------
  describe("JSONL append semantics", () => {
    it("appends multiple entries as separate JSONL lines", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.start(testMeta());
      await writer.userMessage("hello");
      await writer.userMessage("world");

      const entries = await readJsonl(filePath);
      expect(entries).toHaveLength(3);
      expect(entries[0]!.kind).toBe("session_start");
      expect(entries[1]!.kind).toBe("user_message");
      expect(entries[2]!.kind).toBe("user_message");
    });

    it("each line is independently valid JSON", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.start(testMeta());
      await writer.userMessage("line 1");
      await writer.assistantText("response", { agentId: "agt_1" });

      const content = await readFile(filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        // Must not throw.
        const parsed = JSON.parse(line);
        expect(parsed).toBeDefined();
        expect(typeof parsed.kind).toBe("string");
      }
    });

    it("appends to an existing file without truncating", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.start(testMeta());
      await writer.userMessage("first batch");

      // Create a second writer on the same path (simulating resume).
      const writer2 = new SessionWriter({ filePath, log: NULL_LOGGER });
      await writer2.userMessage("second batch");

      const entries = await readJsonl(filePath);
      expect(entries).toHaveLength(3);
      expect((entries[1] as { content: string }).content).toBe("first batch");
      expect((entries[2] as { content: string }).content).toBe("second batch");
    });
  });

  // -----------------------------------------------------------------------
  // ISO 8601 timestamps
  // -----------------------------------------------------------------------
  describe("ISO 8601 timestamps", () => {
    it("every entry has a valid ISO 8601 timestamp", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.start(testMeta());
      await writer.userMessage("msg");
      await writer.assistantText("text", { agentId: "agt_1" });
      await writer.toolCall({
        callId: "tc_1",
        toolName: "Read",
        input: { path: "/foo.ts" },
        agentId: "agt_1",
      });
      await writer.toolResult({
        callId: "tc_1",
        ok: true,
        output: "contents",
        agentId: "agt_1",
      });
      await writer.agentEvent({
        event: "spawned",
        agentId: "agt_2",
        data: { parentId: "agt_1" },
      });
      await writer.end("user_exit");

      const entries = await readJsonl(filePath);
      for (const entry of entries) {
        expect(entry.ts).toMatch(ISO_8601_RE);
        // Also verify it parses as a valid Date.
        expect(Number.isNaN(Date.parse(entry.ts))).toBe(false);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Convenience methods produce correct kinds
  // -----------------------------------------------------------------------
  describe("convenience methods", () => {
    it("userMessage() produces a user_message entry with content", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.userMessage("hello world");

      const entries = await readJsonl(filePath);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.kind).toBe("user_message");
      expect((entries[0] as { content: string }).content).toBe("hello world");
    });

    it("userMessage() includes agentId when provided", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.userMessage("hi", "agt_parent");

      const entries = await readJsonl(filePath);
      expect((entries[0] as { agentId?: string }).agentId).toBe("agt_parent");
    });

    it("userMessage() omits agentId when not provided", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.userMessage("hi");

      const entries = await readJsonl(filePath);
      expect(entries[0]!.agentId).toBeUndefined();
    });

    it("assistantText() produces an assistant_text entry", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.assistantText("partial", { agentId: "agt_1" });

      const entries = await readJsonl(filePath);
      expect(entries[0]!.kind).toBe("assistant_text");
      const entry = entries[0] as { delta: string; final?: boolean };
      expect(entry.delta).toBe("partial");
      expect(entry.final).toBeUndefined();
    });

    it("assistantText() includes final flag when set", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.assistantText("done", { agentId: "agt_1", final: true });

      const entries = await readJsonl(filePath);
      const entry = entries[0] as { final?: boolean };
      expect(entry.final).toBe(true);
    });

    it("toolCall() produces a tool_call entry", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.toolCall({
        callId: "tc_abc",
        toolName: "Bash",
        input: { command: "ls" },
        summary: "ls",
        agentId: "agt_1",
      });

      const entries = await readJsonl(filePath);
      expect(entries[0]!.kind).toBe("tool_call");
      const entry = entries[0] as {
        callId: string;
        toolName: string;
        input: unknown;
        summary?: string;
      };
      expect(entry.callId).toBe("tc_abc");
      expect(entry.toolName).toBe("Bash");
      expect(entry.input).toEqual({ command: "ls" });
      expect(entry.summary).toBe("ls");
    });

    it("toolCall() omits summary when not provided", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.toolCall({
        callId: "tc_x",
        toolName: "Read",
        input: { path: "/a.ts" },
        agentId: "agt_1",
      });

      const entries = await readJsonl(filePath);
      const entry = entries[0] as { summary?: string };
      expect(entry.summary).toBeUndefined();
    });

    it("toolResult() produces a tool_result entry with ok=true", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.toolResult({
        callId: "tc_abc",
        ok: true,
        output: "file contents here",
        agentId: "agt_1",
      });

      const entries = await readJsonl(filePath);
      expect(entries[0]!.kind).toBe("tool_result");
      const entry = entries[0] as { callId: string; ok: boolean; output: unknown };
      expect(entry.callId).toBe("tc_abc");
      expect(entry.ok).toBe(true);
      expect(entry.output).toBe("file contents here");
    });

    it("toolResult() produces a tool_result entry with ok=false and error", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.toolResult({
        callId: "tc_fail",
        ok: false,
        error: { kind: "ToolExecutionError", message: "ENOENT" },
        agentId: "agt_1",
      });

      const entries = await readJsonl(filePath);
      const entry = entries[0] as {
        ok: boolean;
        error?: { kind: string; message: string };
      };
      expect(entry.ok).toBe(false);
      expect(entry.error).toEqual({ kind: "ToolExecutionError", message: "ENOENT" });
    });

    it("agentEvent() produces an agent_event entry", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.agentEvent({
        event: "spawned",
        agentId: "agt_sub",
        data: { parentId: "agt_main", skillName: "explorer" },
      });

      const entries = await readJsonl(filePath);
      expect(entries[0]!.kind).toBe("agent_event");
      const entry = entries[0] as {
        event: string;
        agentId: string;
        data?: Record<string, unknown>;
      };
      expect(entry.event).toBe("spawned");
      expect(entry.agentId).toBe("agt_sub");
      expect(entry.data).toEqual({ parentId: "agt_main", skillName: "explorer" });
    });
  });

  // -----------------------------------------------------------------------
  // Flush / close behavior (end())
  // -----------------------------------------------------------------------
  describe("flush and close behavior (end())", () => {
    it("end() writes a session_end entry", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.start(testMeta());
      await writer.end("user_exit");

      const entries = await readJsonl(filePath);
      expect(entries).toHaveLength(2);
      expect(entries[1]!.kind).toBe("session_end");
    });

    it("session_end entry contains the reason", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.end("error", { code: 42 });

      const entries = await readJsonl(filePath);
      const entry = entries[0] as { reason: string; details?: Record<string, unknown> };
      expect(entry.reason).toBe("error");
      expect(entry.details).toEqual({ code: 42 });
    });

    it("session_end entry omits details when not provided", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.end("completed");

      const entries = await readJsonl(filePath);
      const entry = entries[0] as { reason: string; details?: Record<string, unknown> };
      expect(entry.reason).toBe("completed");
      expect(entry.details).toBeUndefined();
    });

    it("end() flushes all queued writes before resolving", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      // Fire several appends without awaiting, then call end().
      void writer.start(testMeta());
      void writer.userMessage("msg1");
      void writer.userMessage("msg2");
      await writer.end("user_exit");

      // After end() resolves, all writes must be on disk.
      const entries = await readJsonl(filePath);
      expect(entries).toHaveLength(4);
      expect(entries[3]!.kind).toBe("session_end");
    });
  });

  // -----------------------------------------------------------------------
  // Path accessor
  // -----------------------------------------------------------------------
  describe("path()", () => {
    it("returns the file path passed to the constructor", () => {
      const filePath = join(tmpDir, "test.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });
      expect(writer.path()).toBe(filePath);
    });
  });

  // -----------------------------------------------------------------------
  // Event IDs are unique
  // -----------------------------------------------------------------------
  describe("event IDs", () => {
    it("each entry gets a unique id", async () => {
      const filePath = join(tmpDir, "session.jsonl");
      const writer = new SessionWriter({ filePath, log: NULL_LOGGER });

      await writer.start(testMeta());
      await writer.userMessage("a");
      await writer.userMessage("b");
      await writer.end("completed");

      const entries = await readJsonl(filePath);
      const ids = entries.map((e) => e.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  describe("error handling", () => {
    it("logs an error and continues when append fails (e.g. bad path)", async () => {
      // Use a path that cannot be created (a directory that doesn't exist).
      const filePath = join(tmpDir, "nonexistent-dir", "sub", "session.jsonl");
      const errors: Array<{ msg: string }> = [];
      const errorLogger = {
        ...NULL_LOGGER,
        error: (msg: string) => {
          errors.push({ msg });
        },
      };

      const writer = new SessionWriter({ filePath, log: errorLogger });

      // Should not throw — the error is caught and logged.
      await writer.userMessage("will fail");

      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
