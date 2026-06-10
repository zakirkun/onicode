/**
 * Session reader tests.
 *
 * Validates JSONL parsing, crash recovery (missing session_end),
 * entry kind filtering, and malformed line handling.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadSession } from "../../../src/core/session/reader.js";
import type {
  SessionEntry,
  SessionMeta,
  SessionStartEntry,
  UserMessageEntry,
  AssistantTextEntry,
  SessionEndEntry,
} from "../../../src/core/session/types.js";

/**
 * Helper: create a minimal session_start entry.
 */
function makeSessionStart(id: string = "test-session"): SessionStartEntry {
  const meta: SessionMeta = {
    id,
    createdAt: "2026-06-10T10:00:00.000Z",
    cwd: "/test/workspace",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    version: "0.5.0",
  };
  return {
    id: "entry-1",
    ts: "2026-06-10T10:00:00.000Z",
    kind: "session_start",
    meta,
  };
}

/**
 * Helper: create a user_message entry.
 */
function makeUserMessage(content: string, id: string = "msg-1"): UserMessageEntry {
  return {
    id,
    ts: "2026-06-10T10:01:00.000Z",
    kind: "user_message",
    content,
  };
}

/**
 * Helper: create an assistant_text entry.
 */
function makeAssistantText(delta: string, id: string = "ast-1"): AssistantTextEntry {
  return {
    id,
    ts: "2026-06-10T10:02:00.000Z",
    kind: "assistant_text",
    delta,
  };
}

/**
 * Helper: create a session_end entry.
 */
function makeSessionEnd(id: string = "end-1"): SessionEndEntry {
  return {
    id,
    ts: "2026-06-10T10:03:00.000Z",
    kind: "session_end",
    reason: "user_exit",
  };
}

/**
 * Helper: write a JSONL file with the given entries.
 */
function writeJsonl(filePath: string, entries: SessionEntry[]): Promise<void> {
  const lines = entries.map((e) => JSON.stringify(e)).join("\n");
  return writeFile(filePath, lines, "utf8");
}

describe("loadSession", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "onicode-session-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function sessionPath(name: string = "test.jsonl"): string {
    return path.join(tempDir, name);
  }

  // ─── Valid session file ────────────────────────────────────────────

  it("reads a valid JSONL session file with all entry types", async () => {
    const entries: SessionEntry[] = [
      makeSessionStart("valid-session"),
      makeUserMessage("Hello, world!"),
      makeAssistantText("Hi there!"),
      makeSessionEnd(),
    ];

    const filePath = sessionPath("valid.jsonl");
    await writeJsonl(filePath, entries);

    const state = await loadSession(filePath);

    expect(state.meta.id).toBe("valid-session");
    expect(state.meta.model).toBe("claude-sonnet-4-20250514");
    expect(state.entries).toHaveLength(4);
    expect(state.entries[0].kind).toBe("session_start");
    expect(state.entries[1].kind).toBe("user_message");
    expect(state.entries[2].kind).toBe("assistant_text");
    expect(state.entries[3].kind).toBe("session_end");
  });

  it("preserves all fields from session entries", async () => {
    const start = makeSessionStart("full-fields");
    const user = makeUserMessage("Test message");
    const assistant = makeAssistantText("Response");

    const entries: SessionEntry[] = [start, user, assistant];
    const filePath = sessionPath("full.jsonl");
    await writeJsonl(filePath, entries);

    const state = await loadSession(filePath);

    expect(state.entries[0]).toEqual(start);
    expect(state.entries[1]).toEqual(user);
    expect(state.entries[2]).toEqual(assistant);
  });

  // ─── Crash-recovered sessions ──────────────────────────────────────

  it("handles crash-recovered sessions (no session_end)", async () => {
    const entries: SessionEntry[] = [
      makeSessionStart("crashed-session"),
      makeUserMessage("Started working..."),
      makeAssistantText("Processing..."),
      // No session_end — simulates a crash
    ];

    const filePath = sessionPath("crashed.jsonl");
    await writeJsonl(filePath, entries);

    const state = await loadSession(filePath);

    expect(state.meta.id).toBe("crashed-session");
    expect(state.entries).toHaveLength(3);
    expect(state.entries[2].kind).toBe("assistant_text");
    // No session_end entry should be present
    expect(state.entries.find((e) => e.kind === "session_end")).toBeUndefined();
  });

  it("recovers session with only session_start", async () => {
    const entries: SessionEntry[] = [makeSessionStart("minimal-crash")];

    const filePath = sessionPath("minimal.jsonl");
    await writeJsonl(filePath, entries);

    const state = await loadSession(filePath);

    expect(state.meta.id).toBe("minimal-crash");
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].kind).toBe("session_start");
  });

  // ─── Malformed lines ──────────────────────────────────────────────

  it("skips malformed JSON lines and continues parsing", async () => {
    const start = makeSessionStart("with-errors");
    const user = makeUserMessage("Valid message");

    const lines = [
      JSON.stringify(start),
      "{ this is not valid json }}}",
      JSON.stringify(user),
      "<<<also not json>>>",
    ];

    const filePath = sessionPath("malformed.jsonl");
    await writeFile(filePath, lines.join("\n"), "utf8");

    const state = await loadSession(filePath);

    expect(state.meta.id).toBe("with-errors");
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0].kind).toBe("session_start");
    expect(state.entries[1].kind).toBe("user_message");
  });

  it("skips lines that are valid JSON but not session entries", async () => {
    const start = makeSessionStart("wrong-shape");
    const user = makeUserMessage("Real entry");

    const lines = [
      JSON.stringify(start),
      JSON.stringify({ foo: "bar", baz: 123 }), // Valid JSON, wrong shape
      JSON.stringify(user),
      JSON.stringify(null), // Valid JSON, not an object
    ];

    const filePath = sessionPath("wrong-shape.jsonl");
    await writeFile(filePath, lines.join("\n"), "utf8");

    const state = await loadSession(filePath);

    expect(state.meta.id).toBe("wrong-shape");
    expect(state.entries).toHaveLength(2);
    expect(state.entries[0].kind).toBe("session_start");
    expect(state.entries[1].kind).toBe("user_message");
  });

  it("logs malformed lines when logger is provided", async () => {
    const warnings: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const mockLogger = {
      debug: () => {},
      info: () => {},
      warn: (msg: string, meta?: Record<string, unknown>) => {
        warnings.push({ msg, meta });
      },
      error: () => {},
      child: () => mockLogger,
    };

    const start = makeSessionStart("logged-errors");
    const lines = [
      JSON.stringify(start),
      "malformed line",
    ];

    const filePath = sessionPath("logged.jsonl");
    await writeFile(filePath, lines.join("\n"), "utf8");

    await loadSession(filePath, { log: mockLogger });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].msg).toBe("session: malformed line");
    expect(warnings[0].meta?.lineNumber).toBe(2);
    expect(warnings[0].meta?.filePath).toBe(filePath);
  });

  // ─── Empty file handling ──────────────────────────────────────────

  it("throws on empty file (no session_start)", async () => {
    const filePath = sessionPath("empty.jsonl");
    await writeFile(filePath, "", "utf8");

    await expect(loadSession(filePath)).rejects.toThrow(
      /missing a session_start entry/,
    );
  });

  it("throws on file with only blank lines", async () => {
    const filePath = sessionPath("blank.jsonl");
    await writeFile(filePath, "\n\n\n", "utf8");

    await expect(loadSession(filePath)).rejects.toThrow(
      /missing a session_start entry/,
    );
  });

  it("throws when session_start is missing", async () => {
    const entries: SessionEntry[] = [
      makeUserMessage("Orphan message"),
      makeAssistantText("Orphan response"),
    ];

    const filePath = sessionPath("no-start.jsonl");
    await writeJsonl(filePath, entries);

    await expect(loadSession(filePath)).rejects.toThrow(
      /missing a session_start entry/,
    );
  });

  // ─── Edge cases ───────────────────────────────────────────────────

  it("handles empty lines within the file", async () => {
    const start = makeSessionStart("with-blanks");
    const user = makeUserMessage("Message");

    const lines = [
      JSON.stringify(start),
      "",
      "\n",
      JSON.stringify(user),
      "",
    ];

    const filePath = sessionPath("blanks.jsonl");
    await writeFile(filePath, lines.join("\n"), "utf8");

    const state = await loadSession(filePath);

    expect(state.meta.id).toBe("with-blanks");
    expect(state.entries).toHaveLength(2);
  });

  it("handles trailing newlines", async () => {
    const entries: SessionEntry[] = [
      makeSessionStart("trailing"),
      makeUserMessage("Test"),
    ];

    const filePath = sessionPath("trailing.jsonl");
    const lines = entries.map((e) => JSON.stringify(e)).join("\n");
    await writeFile(filePath, lines + "\n\n", "utf8");

    const state = await loadSession(filePath);

    expect(state.meta.id).toBe("trailing");
    expect(state.entries).toHaveLength(2);
  });

  it("extracts meta from the first session_start entry", async () => {
    const start1 = makeSessionStart("first-start");
    const start2: SessionStartEntry = {
      id: "entry-dup",
      ts: "2026-06-10T10:00:01.000Z",
      kind: "session_start",
      meta: {
        id: "second-start",
        createdAt: "2026-06-10T10:00:01.000Z",
        cwd: "/other",
        model: "gpt-4",
        provider: "openai",
        version: "0.5.0",
      },
    };

    const entries: SessionEntry[] = [start1, start2];
    const filePath = sessionPath("dup-start.jsonl");
    await writeJsonl(filePath, entries);

    const state = await loadSession(filePath);

    // Should use the first session_start's meta
    expect(state.meta.id).toBe("first-start");
    expect(state.meta.model).toBe("claude-sonnet-4-20250514");
  });

  it("throws on non-existent file", async () => {
    const filePath = sessionPath("does-not-exist.jsonl");

    await expect(loadSession(filePath)).rejects.toThrow(/ENOENT/);
  });
});
