/**
 * Path utilities for OniCode.
 *
 * Centralizes the rules for:
 * - Expanding `~` to the user home directory.
 * - Resolving paths against a base directory (typically `cwd`).
 * - Locating OniCode's user-level data directories (`~/.onicode/...`).
 *
 * These helpers exist so that callers never need to import `os`/`path`
 * directly for these conventions, which keeps OS-specific quirks
 * (e.g. Windows backslashes, missing `HOME` on Windows) localized.
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Root user directory for OniCode persistent data. Resolves to `~/.onicode`. */
export const USER_DIR_NAME = ".onicode";

/**
 * Expand a leading `~` in a path to the user's home directory.
 *
 * Idempotent for paths that do not start with `~`.
 *
 * @param p - input path, possibly starting with `~` or `~/`.
 * @returns absolute or relative path with `~` expanded.
 */
export function expandHome(p: string): string {
  if (p === "~") {
    return homedir();
  }
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Resolve a path against a base directory. Absolute paths are returned as-is
 * (after `~` expansion); relative paths are joined with the base.
 *
 * @param base - directory used as the resolution root for relative paths.
 * @param p - target path.
 * @returns absolute, normalized path.
 */
export function resolveAgainst(base: string, p: string): string {
  const expanded = expandHome(p);
  if (path.isAbsolute(expanded)) {
    return path.normalize(expanded);
  }
  return path.normalize(path.resolve(base, expanded));
}

/**
 * Ensure a directory exists, creating it (and any missing parents) if not.
 * Safe to call repeatedly; no-op if the directory already exists.
 *
 * @param dir - target directory path.
 */
export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Absolute path to the user-level OniCode root (`~/.onicode`). */
export function userRootDir(): string {
  return path.join(homedir(), USER_DIR_NAME);
}

/** Absolute path to the user-level config file (`~/.onicode/config.json`). */
export function userConfigPath(): string {
  return path.join(userRootDir(), "config.json");
}

/** Absolute path to the user-level session directory (`~/.onicode/sessions`). */
export function userSessionDir(): string {
  return path.join(userRootDir(), "sessions");
}

/** Absolute path to the user-level skills directory (`~/.onicode/skills`). */
export function userSkillDir(): string {
  return path.join(userRootDir(), "skills");
}

/** Absolute path to the project-level config file at `<cwd>/onicode.config.json`. */
export function projectConfigPath(cwd: string): string {
  return path.join(cwd, "onicode.config.json");
}

/** Absolute path to the project-level skills directory at `<cwd>/.onicode/skills`. */
export function projectSkillDir(cwd: string): string {
  return path.join(cwd, USER_DIR_NAME, "skills");
}
