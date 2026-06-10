/**
 * Session JSONL writer.
 *
 * Appends one JSON object per line to `~/.onicode/sessions/<id>.jsonl`.
 * Uses Node's `fs.appendFile` which guarantees POSIX atomicity for writes
 * smaller than `PIPE_BUF` (typically 4096 bytes); larger entries may be
 * partially interleaved if multiple agents share the same writer, so the
 * writer serializes appends through a single internal queue.
 *
 * Privacy: this writer does not redact `user_message.content` or
 * `assistant_text.delta`. Operators concerned about PII must redact at the
 * call site or run sessions in memory-only mode.
 */
import { appendFile } from "node:fs/promises";

import type {
  AgentEventEntry,
  AssistantTextEntry,
  SessionEndEntry,
  SessionEntry,
  SessionMeta,
  SessionStartEntry,
  ToolCallEntry,
  ToolResultEntry,
  UserMessageEntry,
} from "./types.js";
import { newEventId } from "../../utils/idgen.js";
import type { Logger } from "../../utils/logger.js";

/** Construction options for {@link SessionWriter}. */
export interface SessionWriterOptions {
  /** Absolute path to the JSONL file to append to. */
  filePath: string;
  /** Logger for diagnostic messages (file errors, etc). */
  log: Logger;
}

/**
 * Append-only writer for session JSONL files.
 *
 * The writer is the only object permitted to write to the JSONL file —
 * concurrent writers on the same path will produce interleaved entries
 * even with this serialization, because each writer has its own queue.
 */
export class SessionWriter {
  private readonly filePath: string;
  private readonly log: Logger;
  /** Tail of the append queue. Each new write chains off this promise. */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(opts: SessionWriterOptions) {
    this.filePath = opts.filePath;
    this.log = opts.log;
  }

  /** Path of the file being written. */
  path(): string {
    return this.filePath;
  }

  /**
   * Append a fully-formed entry. Public for callers that need exotic
   * payloads; the convenience methods below cover the common cases.
   *
   * @param entry - the entry to write.
   */
  append(entry: SessionEntry): Promise<void> {
    const line = `${JSON.stringify(entry)}\n`;
    const next = this.writeQueue.then(() =>
      appendFile(this.filePath, line, "utf8").catch((err: unknown) => {
        this.log.error("session append failed", { err, file: this.filePath });
      }),
    );
    this.writeQueue = next;
    return next;
  }

  /**
   * Write the `session_start` entry containing the session meta.
   * @returns resolves when the entry is flushed to disk.
   */
  start(meta: SessionMeta): Promise<void> {
    const entry: SessionStartEntry = {
      id: newEventId(),
      ts: new Date().toISOString(),
      kind: "session_start",
      meta,
    };
    return this.append(entry);
  }

  /**
   * Convenience: append a `user_message` entry.
   * @returns resolves when the entry is queued.
   */
  userMessage(content: string, agentId?: string): Promise<void> {
    const entry: UserMessageEntry = {
      id: newEventId(),
      ts: new Date().toISOString(),
      kind: "user_message",
      content,
      ...(agentId ? { agentId } : {}),
    };
    return this.append(entry);
  }

  /**
   * Convenience: append an `assistant_text` entry (delta or final).
   * @returns resolves when the entry is queued.
   */
  assistantText(delta: string, opts: { agentId: string; final?: boolean }): Promise<void> {
    const entry: AssistantTextEntry = {
      id: newEventId(),
      ts: new Date().toISOString(),
      kind: "assistant_text",
      delta,
      agentId: opts.agentId,
      ...(opts.final ? { final: true } : {}),
    };
    return this.append(entry);
  }

  /**
   * Convenience: append a `tool_call` entry.
   * @returns resolves when the entry is queued.
   */
  toolCall(args: {
    callId: string;
    toolName: string;
    input: unknown;
    summary?: string;
    agentId: string;
  }): Promise<void> {
    const entry: ToolCallEntry = {
      id: newEventId(),
      ts: new Date().toISOString(),
      kind: "tool_call",
      callId: args.callId,
      toolName: args.toolName,
      input: args.input,
      ...(args.summary !== undefined ? { summary: args.summary } : {}),
      agentId: args.agentId,
    };
    return this.append(entry);
  }

  /**
   * Convenience: append a `tool_result` entry.
   * @returns resolves when the entry is queued.
   */
  toolResult(args: {
    callId: string;
    ok: boolean;
    output?: unknown;
    error?: { kind: string; message: string };
    agentId: string;
  }): Promise<void> {
    const entry: ToolResultEntry = {
      id: newEventId(),
      ts: new Date().toISOString(),
      kind: "tool_result",
      callId: args.callId,
      ok: args.ok,
      ...(args.output !== undefined ? { output: args.output } : {}),
      ...(args.error ? { error: args.error } : {}),
      agentId: args.agentId,
    };
    return this.append(entry);
  }

  /**
   * Convenience: append an `agent_event` entry.
   * @returns resolves when the entry is queued.
   */
  agentEvent(args: {
    event: AgentEventEntry["event"];
    agentId: string;
    data?: Record<string, unknown>;
  }): Promise<void> {
    const entry: AgentEventEntry = {
      id: newEventId(),
      ts: new Date().toISOString(),
      kind: "agent_event",
      event: args.event,
      agentId: args.agentId,
      ...(args.data ? { data: args.data } : {}),
    };
    return this.append(entry);
  }

  /**
   * Convenience: write the `session_end` entry and flush.
   * @returns resolves when all queued writes have flushed to disk.
   */
  async end(reason: SessionEndEntry["reason"], details?: Record<string, unknown>): Promise<void> {
    const entry: SessionEndEntry = {
      id: newEventId(),
      ts: new Date().toISOString(),
      kind: "session_end",
      reason,
      ...(details ? { details } : {}),
    };
    await this.append(entry);
    // Make sure all queued writes have flushed before the caller exits.
    await this.writeQueue;
  }
}
