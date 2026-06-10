/**
 * Session manager.
 *
 * High-level lifecycle helpers wrapped around `SessionWriter` and
 * `loadSession`. Owns session id allocation, file path resolution, and
 * directory bootstrapping.
 *
 * Three operations:
 *
 *   - `create(...)` — start a fresh session, write the `session_start`
 *     entry, return a writer ready for further appends.
 *   - `resume(...)` — load an existing session, return its replayed state
 *     plus a writer that will append new entries to the same file.
 *   - `list()` — enumerate sessions in the storage directory by reading
 *     each file's first line.
 */
import { open, readdir } from "node:fs/promises";
import path from "node:path";

import { loadSession } from "./reader.js";
import type { SessionMeta, SessionState } from "./types.js";
import { SessionWriter } from "./writer.js";
import { ensureDir } from "../../utils/pathUtils.js";
import { newSessionId } from "../../utils/idgen.js";
import type { Logger } from "../../utils/logger.js";

/** Construction options for {@link SessionManager}. */
export interface SessionManagerOptions {
  /** Directory holding session JSONL files. */
  baseDir: string;
  /** Logger for diagnostics. */
  log: Logger;
}

/** Newly-created session handle. */
export interface CreatedSession {
  sessionId: string;
  filePath: string;
  writer: SessionWriter;
}

/** Resumed session handle. */
export interface ResumedSession {
  state: SessionState;
  filePath: string;
  writer: SessionWriter;
}

/** Inputs needed to bootstrap a new session's `session_start` entry. */
export interface CreateSessionInput {
  cwd: string;
  model: string;
  provider: string;
  version: string;
}

/** Lifecycle helpers around `SessionWriter` and `loadSession`. */
export class SessionManager {
  private readonly baseDir: string;
  private readonly log: Logger;

  constructor(opts: SessionManagerOptions) {
    this.baseDir = opts.baseDir;
    this.log = opts.log;
  }

  /**
   * Create a new session: allocate id, write the `session_start` entry,
   * return a writer ready for further appends.
   *
   * @param input - data captured in the session_start entry.
   * @returns a {@link CreatedSession} handle with id, file path, and writer.
   */
  async create(input: CreateSessionInput): Promise<CreatedSession> {
    await ensureDir(this.baseDir);
    const sessionId = newSessionId();
    const filePath = path.join(this.baseDir, `${sessionId}.jsonl`);
    const writer = new SessionWriter({ filePath, log: this.log });
    const meta: SessionMeta = {
      id: sessionId,
      createdAt: new Date().toISOString(),
      cwd: input.cwd,
      model: input.model,
      provider: input.provider,
      version: input.version,
    };
    await writer.start(meta);
    return { sessionId, filePath, writer };
  }

  /**
   * Resume an existing session by id. Returns the replayed state plus a
   * writer for appending new entries.
   *
   * @param sessionId - session id (matches the JSONL filename minus extension).
   * @returns a {@link ResumedSession} with replayed state, file path, and writer.
   */
  async resume(sessionId: string): Promise<ResumedSession> {
    const filePath = path.join(this.baseDir, `${sessionId}.jsonl`);
    const state = await loadSession(filePath, { log: this.log });
    const writer = new SessionWriter({ filePath, log: this.log });
    return { state, filePath, writer };
  }

  /**
   * List all session metadata in the base directory by reading the first
   * line of each `.jsonl` file. Files without a valid `session_start`
   * entry are skipped silently.
   *
   * @returns array of session metas, sorted newest-first by `createdAt`.
   */
  async list(): Promise<SessionMeta[]> {
    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch (err: unknown) {
      if (isFileNotFound(err)) {
        return [];
      }
      throw err;
    }

    const metas: SessionMeta[] = [];
    for (const name of entries) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const filePath = path.join(this.baseDir, name);
      const meta = await this.readFirstMeta(filePath);
      if (meta) {
        metas.push(meta);
      }
    }
    metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return metas;
  }

  /**
   * Read the first `session_start` entry from a file without loading the
   * full transcript. Returns `null` if the file is unreadable or
   * malformed.
   */
  private async readFirstMeta(filePath: string): Promise<SessionMeta | null> {
    let handle;
    try {
      handle = await open(filePath, "r");
    } catch {
      return null;
    }
    try {
      for await (const line of handle.readLines({ encoding: "utf8" })) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed) as { kind?: string; meta?: SessionMeta };
          if (parsed.kind === "session_start" && parsed.meta) {
            return parsed.meta;
          }
        } catch {
          // Ignore — non-JSON line.
        }
        // Stop after the first non-empty line; the start entry must be first.
        return null;
      }
      return null;
    } finally {
      await handle.close();
    }
  }
}

/** Detect Node's `ENOENT`. */
function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
