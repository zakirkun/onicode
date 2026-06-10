/**
 * YAML frontmatter parser thin wrapper.
 *
 * Wraps the `gray-matter` library so that the rest of OniCode does not need
 * to know which underlying parser is in use; if we later swap to a different
 * implementation (e.g. a hand-rolled parser to drop the dependency), only
 * this file changes.
 *
 * The expected input shape is the conventional Markdown-with-frontmatter
 * format used by Jekyll, Hugo, and Claude Code skills:
 *
 *     ---
 *     name: explorer
 *     description: Read-only code search
 *     ---
 *
 *     Body text starts here.
 */
import matter from "gray-matter";

/**
 * Result of parsing a frontmatter document.
 *
 * `data` is intentionally typed as `Record<string, unknown>` rather than a
 * specific schema — the caller is expected to validate the shape (typically
 * with zod) before using the fields.
 */
export interface ParsedFrontmatter {
  /** Parsed YAML frontmatter object; empty object if no frontmatter present. */
  data: Record<string, unknown>;
  /** Markdown body following the frontmatter block, with leading whitespace trimmed. */
  body: string;
}

/**
 * Parse a Markdown string with optional YAML frontmatter.
 *
 * If the input has no frontmatter block, `data` is an empty object and
 * `body` is the entire input.
 *
 * @param source - raw Markdown text.
 * @returns parsed frontmatter object and trimmed body.
 */
export function parseFrontmatter(source: string): ParsedFrontmatter {
  const result = matter(source);
  return {
    data: (result.data ?? {}) as Record<string, unknown>,
    body: result.content.trimStart(),
  };
}
