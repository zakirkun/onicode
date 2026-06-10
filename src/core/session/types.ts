/**
 * Session transcript types.
 *
 * A session is a JSONL file at `~/.onicode/sessions/<sessionId>.jsonl`.
 * Each line is one JSON object — a `SessionEntry` — recording a discrete
 * event in the conversation: a user message, an assistant token, a tool
 * call, a tool result, etc.
 *
 * The first line is always a `session_start` entry containing the
 * `SessionMeta`. The last line, if the session terminated cleanly, is a
 * `session_end` entry. Sessions truncated by a crash simply have no end
 * entry; the reader treats this as recoverable.
 *
 * All timestamps are ISO 8601 strings (e.g. `2026-06-09T06:19:29.111Z`)
 * for portability across log analysis tools.
 *
 * Privacy: user prose and assistant prose are recorded verbatim under the
 * `content`/`delta` fields. Operators concerned about PII should configure
 * an allow / deny set on the writer (future work) or run sessions in
 * memory-only mode by setting `session.dir` to `"-"`.
 */

/** Discriminator union of session entry kinds. */
export type SessionEntryKind =
  | "session_start"
  | "user_message"
  | "assistant_text"
  | "tool_call"
  | "tool_result"
  | "agent_event"
  | "session_end";

/** Common fields present on every entry. */
interface SessionEntryBase {
  /** Stable id for cross-referencing within a session. */
  id: string;
  /** ISO 8601 timestamp at which the entry was appended. */
  ts: string;
  /** Discriminator. */
  kind: SessionEntryKind;
  /** Owning agent id (top-level or sub-agent). Optional for `session_start`. */
  agentId?: string;
}

/** Metadata recorded at session start. */
export interface SessionMeta {
  /** Session id (matches the JSONL filename, minus extension). */
  id: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** Working directory the session was launched in. */
  cwd: string;
  /** LLM model used by the top-level agent at session start. */
  model: string;
  /** Provider id (`anthropic`, `openai`, `ollama`). */
  provider: string;
  /** OniCode binary version (from package.json). */
  version: string;
}

/** First line of every session. */
export interface SessionStartEntry extends SessionEntryBase {
  kind: "session_start";
  meta: SessionMeta;
}

/** A user-supplied message. */
export interface UserMessageEntry extends SessionEntryBase {
  kind: "user_message";
  content: string;
}

/**
 * A streamed assistant text token (or a complete final message). Streaming
 * sessions append many `assistant_text` entries per turn; non-streaming
 * sessions append a single one.
 */
export interface AssistantTextEntry extends SessionEntryBase {
  kind: "assistant_text";
  /** Text delta or the full message body. */
  delta: string;
  /** True when this entry contains the final, complete message body. */
  final?: boolean;
}

/** A tool call as emitted by the LLM. */
export interface ToolCallEntry extends SessionEntryBase {
  kind: "tool_call";
  /** Tool call id (matches `ToolCall.id`). */
  callId: string;
  /** Registered tool name. */
  toolName: string;
  /** Raw input the LLM produced. */
  input: unknown;
  /** Tool's `summarize(input)` output, captured for replay UIs. */
  summary?: string;
}

/** Result of a tool call. */
export interface ToolResultEntry extends SessionEntryBase {
  kind: "tool_result";
  callId: string;
  ok: boolean;
  output?: unknown;
  error?: { kind: string; message: string };
}

/** Coordinator / agent lifecycle event (spawn, stop, abort). */
export interface AgentEventEntry extends SessionEntryBase {
  kind: "agent_event";
  /** Sub-kind for filtering. */
  event: "spawned" | "stopped" | "aborted" | "summary";
  /** Free-form data (e.g. parent id, token usage, summary text). */
  data?: Record<string, unknown>;
}

/** Last line of a cleanly-terminated session. */
export interface SessionEndEntry extends SessionEntryBase {
  kind: "session_end";
  /** Why the session ended. */
  reason: "user_exit" | "error" | "completed";
  /** Optional structured details. */
  details?: Record<string, unknown>;
}

/** Tagged union of all entry shapes. */
export type SessionEntry =
  | SessionStartEntry
  | UserMessageEntry
  | AssistantTextEntry
  | ToolCallEntry
  | ToolResultEntry
  | AgentEventEntry
  | SessionEndEntry;

/** In-memory representation of a session loaded by the reader. */
export interface SessionState {
  meta: SessionMeta;
  entries: SessionEntry[];
}
