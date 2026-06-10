/**
 * Session JSONL reader.
 *
 * Loads a session file produced by `SessionWriter` back into memory as a
 * `SessionState` for resumption (continuing a conversation), replay
 * (rendering history in the TUI), or inspection (debug commands).
 *
 * The reader is permissive: malformed lines are logged and skipped rather
 * than aborting the load, because a partially corrupt transcript is still
 * useful for recovery. The first `session_start` entry is mandatory; if it
 * is missing or malformed the loader throws.
 */
import { open } from "node:fs/promises";

import type { SessionEntry, SessionMeta, SessionState, SessionStartEntry } from "./types.js";
import type { Logger } from "../../utils/logger.js";

/** Options for {@link loadSession}. */
export interface LoadSessionOptions {
  /** Logger for diagnostic messages on malformed lines. */
  log?: Logger;
}

/**
 * Load and parse a session JSONL file.
 *
 * @param filePath - absolute path to the JSONL file.
 * @param opts - optional load options.
 * @returns parsed `SessionState`.
 * @throws if the file cannot be read or the first `session_start` entry
 *         is missing/malformed.
 */
export async function loadSession(
  filePath: string,
  opts: LoadSessionOptions = {},
): Promise<SessionState> {
  const handle = await open(filePath, "r");
  try {
    const entries: SessionEntry[] = [];
    let lineNumber = 0;
    for await (const line of handle.readLines({ encoding: "utf8" })) {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const parsed = tryParse(trimmed);
      if (!parsed) {
        opts.log?.warn("session: malformed line", { filePath, lineNumber });
        continue;
      }
      entries.push(parsed);
    }

    const meta = extractMeta(entries);
    if (!meta) {
      throw new Error(`Session file ${filePath} is missing a session_start entry.`);
    }
    return { meta, entries };
  } finally {
    await handle.close();
  }
}

/** Parse a single JSONL line; returns null on failure. */
function tryParse(line: string): SessionEntry | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (!isSessionEntry(value)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/** Structural check that a parsed JSON value looks like a `SessionEntry`. */
function isSessionEntry(v: unknown): v is SessionEntry {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const obj = v as Record<string, unknown>;
  return typeof obj.id === "string" && typeof obj.ts === "string" && typeof obj.kind === "string";
}

/** Find the first `session_start` entry and return its meta. */
function extractMeta(entries: readonly SessionEntry[]): SessionMeta | null {
  for (const entry of entries) {
    if (entry.kind === "session_start") {
      const start = entry as SessionStartEntry;
      return start.meta;
    }
  }
  return null;
}
