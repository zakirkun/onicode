/**
 * Permission rule matcher.
 *
 * Implements the matching half of the permission system. Rule format is
 * documented on `PermissionRule` in `./types.ts`; this module parses such
 * strings and matches them against `(toolName, inputSummary)` pairs.
 *
 * The matcher has no side effects and no state — pure functions only.
 * That makes it trivially testable and lets the gate hold a parsed-rule
 * cache later if profiling shows parsing is hot.
 */
import type { PermissionRule } from "./types.js";

/** Parsed shape of a {@link PermissionRule}. */
interface ParsedRule {
  /** Glob-or-literal matched against the tool name. `*` matches any tool. */
  toolPattern: string;
  /** Glob (default) or regex source, matched against the input summary. */
  inputPattern: string;
  /** True when `inputPattern` is the source of a regex (rule had `re:` prefix). */
  isRegex: boolean;
}

/**
 * Parse a permission rule into its components.
 *
 * @param rule - rule string of the form `ToolName(pattern)` or `ToolName(re:regex)`.
 * @returns parsed rule, or `null` if the input is malformed.
 */
export function parseRule(rule: PermissionRule): ParsedRule | null {
  const trimmed = rule.trim();
  const match = /^([^()\s]+)\((.*)\)$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const toolPattern = match[1] ?? "";
  const innerPattern = match[2] ?? "";
  if (innerPattern.startsWith("re:")) {
    return {
      toolPattern,
      inputPattern: innerPattern.slice(3),
      isRegex: true,
    };
  }
  return {
    toolPattern,
    inputPattern: innerPattern,
    isRegex: false,
  };
}

/**
 * Match a single rule against a tool call.
 *
 * Returns `false` for malformed rules; the gate is responsible for logging
 * such inputs at warn level (this module does not own a logger).
 *
 * @param rule - rule string.
 * @param toolName - tool name to match against the rule's tool pattern.
 * @param summary - input summary to match against the rule's input pattern.
 */
export function matchRule(rule: PermissionRule, toolName: string, summary: string): boolean {
  const parsed = parseRule(rule);
  if (!parsed) {
    return false;
  }
  if (!matchToolName(parsed.toolPattern, toolName)) {
    return false;
  }
  if (parsed.isRegex) {
    let re: RegExp;
    try {
      re = new RegExp(parsed.inputPattern);
    } catch {
      return false;
    }
    return re.test(summary);
  }
  return globMatch(parsed.inputPattern, summary);
}

/**
 * Match any of the rules against a tool call. Short-circuits on the first
 * matching rule. Empty rule lists yield `false`.
 *
 * @param rules - rule list (allow or deny).
 * @param toolName - tool name to match against each rule's tool pattern.
 * @param summary - input summary to match against each rule's input pattern.
 */
export function matchAny(
  rules: readonly PermissionRule[],
  toolName: string,
  summary: string,
): boolean {
  for (const rule of rules) {
    if (matchRule(rule, toolName, summary)) {
      return true;
    }
  }
  return false;
}

/** Match a tool name against a tool pattern. `*` matches any name. */
function matchToolName(pattern: string, name: string): boolean {
  if (pattern === "*") {
    return true;
  }
  return pattern === name;
}

/**
 * Match a string against a simple glob pattern.
 *
 * Supported syntax:
 * - `*`  matches any single path segment (no `/`).
 * - `**` matches any number of characters, including `/`.
 * - `?`  matches a single character (not `/`).
 * - All other characters match literally.
 *
 * The implementation compiles the glob to a RegExp once per call. Callers
 * concerned about throughput should cache parsed rules at a higher level.
 */
function globMatch(glob: string, input: string): boolean {
  const re = globToRegex(glob);
  return re.test(input);
}

/** Compile a glob pattern to a RegExp anchored on both ends. */
function globToRegex(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++; // consume the second `*`
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch !== undefined && /[.+^${}()|[\]\\]/.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch ?? "";
    }
  }
  out += "$";
  return new RegExp(out);
}
