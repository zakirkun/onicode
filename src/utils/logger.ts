/**
 * Structured logger for OniCode.
 *
 * Design rules:
 * - All logs go to **stderr**, never stdout. Stdout is reserved for assistant
 *   output streamed to the user (especially in headless mode where stdout is
 *   piped or captured).
 * - One JSON object per line, so logs are grep-able and machine-parseable
 *   without losing the convenience of human reading via `jq`.
 * - Levels follow standard syslog-ish ordering: `debug < info < warn < error`.
 * - The logger is a thin interface — there is no global singleton. Each
 *   subsystem receives a `Logger` (typically a child) so that its events
 *   are pre-tagged with `module` metadata.
 *
 * The implementation deliberately avoids depending on `pino` or similar
 * heavyweight frameworks: the JSONL line format is trivial to produce and
 * the resulting bundle stays small.
 */

/** Log level, ordered from most to least verbose. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Numeric severity used for level filtering. */
const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Arbitrary structured metadata attached to a log entry. */
export type LogMeta = Record<string, unknown>;

/**
 * Logger interface used throughout OniCode. Implementations must be safe to
 * call from multiple async contexts (no shared mutable state without
 * synchronization).
 */
export interface Logger {
  debug(msg: string, meta?: LogMeta): void;
  info(msg: string, meta?: LogMeta): void;
  warn(msg: string, meta?: LogMeta): void;
  error(msg: string, meta?: LogMeta): void;
  /**
   * Create a child logger that inherits this logger's level and merges the
   * given metadata into every entry it emits.
   */
  child(meta: LogMeta): Logger;
}

/** Configuration accepted by {@link createLogger}. */
export interface LoggerOptions {
  /** Minimum level to emit. Entries below this level are silently dropped. */
  level?: LogLevel;
  /** Static metadata merged into every log entry. */
  base?: LogMeta;
  /** Override the sink used to emit serialized lines. Defaults to `process.stderr`. */
  sink?: (line: string) => void;
}

/**
 * Create a new logger.
 *
 * @param opts - logger configuration; all fields optional.
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? "info";
  const base = opts.base ?? {};
  const sink = opts.sink ?? ((line) => process.stderr.write(`${line}\n`));
  return new JsonLogger(level, base, sink);
}

/**
 * Default logger implementation. Emits one JSON line per call, serializing
 * non-JSON-safe values (e.g. `Error`) into a stable shape.
 */
class JsonLogger implements Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly base: LogMeta,
    private readonly sink: (line: string) => void,
  ) {}

  debug(msg: string, meta?: LogMeta): void {
    this.emit("debug", msg, meta);
  }

  info(msg: string, meta?: LogMeta): void {
    this.emit("info", msg, meta);
  }

  warn(msg: string, meta?: LogMeta): void {
    this.emit("warn", msg, meta);
  }

  error(msg: string, meta?: LogMeta): void {
    this.emit("error", msg, meta);
  }

  child(meta: LogMeta): Logger {
    return new JsonLogger(this.level, { ...this.base, ...meta }, this.sink);
  }

  private emit(level: LogLevel, msg: string, meta?: LogMeta): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) {
      return;
    }
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.base,
      ...(meta ? sanitize(meta) : {}),
    };
    this.sink(JSON.stringify(entry));
  }
}

/**
 * Convert non-JSON-safe values in a metadata object into a serializable
 * shape. Currently handles `Error` instances; other types are passed through.
 */
function sanitize(meta: LogMeta): LogMeta {
  const out: LogMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

/** Reduce an Error to a JSON-safe object preserving message, name, and stack. */
function serializeError(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
}

/** A no-op logger useful in tests where log output is irrelevant. */
export const NULL_LOGGER: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => NULL_LOGGER,
};
