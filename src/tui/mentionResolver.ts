/**
 * Resolves @-mention queries to file/folder paths.
 *
 * Given a partial query string (typed after @), searches the working
 * directory and returns matching paths for the picker overlay.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, sep } from "node:path";

/** A single file/folder match from an @-mention query. */
export interface MentionResult {
  /** Relative path from cwd (with trailing separator for directories). */
  path: string;
  /** True if the match is a directory. */
  isDir: boolean;
  /** Absolute path on disk. */
  absolutePath: string;
}

/** Options for {@link resolveMention}. */
export interface ResolveOptions {
  cwd: string;
  maxResults?: number;
  maxDepth?: number;
  ignorePatterns?: string[];
}

const DEFAULT_IGNORE = ["node_modules", ".git", "dist", ".onicode", ".claude"];

/**
 * Search `opts.cwd` recursively and return files/folders whose name or
 * relative path contains `query` (case-insensitive).
 */
export async function resolveMention(
  query: string,
  opts: ResolveOptions,
): Promise<MentionResult[]> {
  const maxResults = opts.maxResults ?? 20;
  const maxDepth = opts.maxDepth ?? 4;
  const ignore = opts.ignorePatterns ?? DEFAULT_IGNORE;

  const results: MentionResult[] = [];
  await walk(opts.cwd, "", query.toLowerCase(), ignore, maxDepth, 0, results, maxResults);
  return results;
}

async function walk(
  baseDir: string,
  prefix: string,
  query: string,
  ignore: string[],
  maxDepth: number,
  depth: number,
  results: MentionResult[],
  maxResults: number,
): Promise<void> {
  if (depth > maxDepth || results.length >= maxResults) return;

  const dirPath = join(baseDir, prefix);
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (ignore.includes(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const relPath = prefix ? `${prefix}${sep}${entry.name}` : entry.name;
    const isDir = entry.isDirectory();

    if (
      relPath.toLowerCase().includes(query) ||
      entry.name.toLowerCase().includes(query)
    ) {
      results.push({
        path: relPath + (isDir ? sep : ""),
        isDir,
        absolutePath: join(dirPath, entry.name),
      });
    }

    if (isDir) {
      await walk(baseDir, relPath, query, ignore, maxDepth, depth + 1, results, maxResults);
    }
  }
}

/**
 * Parse @-mention ranges from input text.
 *
 * Returns an array of `{ start, end, query }` where `query` is the text
 * between `@` and the next whitespace (or end of string).
 */
export function findMentions(text: string): Array<{ start: number; end: number; query: string }> {
  const mentions: Array<{ start: number; end: number; query: string }> = [];
  const regex = /@([^\s@]*)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    mentions.push({
      start: match.index,
      end: match.index + match[0]!.length,
      query: match[1] ?? "",
    });
  }
  return mentions;
}

/**
 * Resolve @-mention paths in `text` and inject each matched file's
 * contents inline. Directories are left as-is. Missing files are also
 * left as-is (the picker normally only resolves to existing paths).
 */
export async function expandMentions(
  text: string,
  cwd: string,
): Promise<{ expanded: string; files: string[] }> {
  const mentions = findMentions(text);
  if (mentions.length === 0) return { expanded: text, files: [] };

  const files: string[] = [];
  let result = text;

  // Process in reverse to preserve indices.
  for (let i = mentions.length - 1; i >= 0; i--) {
    const m = mentions[i]!;
    const absPath = join(cwd, m.query);
    try {
      const s = await stat(absPath);
      if (s.isFile()) {
        const content = await readFile(absPath, "utf-8");
        const block = `\n<file path="${m.query}">\n${content}\n</file>\n`;
        result = result.slice(0, m.start) + block + result.slice(m.end);
        files.push(m.query);
      }
    } catch {
      // File not found — leave @mention as-is.
    }
  }

  return { expanded: result, files };
}
