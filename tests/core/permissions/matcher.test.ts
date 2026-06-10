/**
 * Tests for the permission rule matcher.
 *
 * Covers rule parsing, glob matching, regex matching, tool-name wildcards,
 * and the composite `matchAny` helper.
 */
import { describe, it, expect } from "vitest";
import { parseRule, matchRule, matchAny } from "../../../src/core/permissions/matcher.js";

// ---------------------------------------------------------------------------
// parseRule
// ---------------------------------------------------------------------------
describe("parseRule", () => {
  it("parses a simple glob rule", () => {
    const result = parseRule("Read(**)");
    expect(result).toEqual({
      toolPattern: "Read",
      inputPattern: "**",
      isRegex: false,
    });
  });

  it("parses a rule with an exact input pattern", () => {
    const result = parseRule("Bash(npm test)");
    expect(result).toEqual({
      toolPattern: "Bash",
      inputPattern: "npm test",
      isRegex: false,
    });
  });

  it("parses a regex rule with re: prefix", () => {
    const result = parseRule("Bash(re:^git\\s.*)");
    expect(result).toEqual({
      toolPattern: "Bash",
      inputPattern: "^git\\s.*",
      isRegex: true,
    });
  });

  it("parses a wildcard tool name", () => {
    const result = parseRule("*(re:.*secret.*)");
    expect(result).toEqual({
      toolPattern: "*",
      inputPattern: ".*secret.*",
      isRegex: true,
    });
  });

  it("parses a rule with empty input pattern", () => {
    const result = parseRule("Read()");
    expect(result).toEqual({
      toolPattern: "Read",
      inputPattern: "",
      isRegex: false,
    });
  });

  it("parses a rule where input pattern contains parentheses", () => {
    // The regex captures between the *first* ( and the *last* ), so inner
    // parens are part of the input pattern.
    const result = parseRule("Bash(echo (hello))");
    expect(result).not.toBeNull();
    expect(result!.toolPattern).toBe("Bash");
    // The inner content between the outermost parens is "echo (hello)"
    expect(result!.inputPattern).toBe("echo (hello)");
  });

  it("trims leading and trailing whitespace", () => {
    const result = parseRule("  Read(**)  ");
    expect(result).toEqual({
      toolPattern: "Read",
      inputPattern: "**",
      isRegex: false,
    });
  });

  it("returns null for a rule without parentheses", () => {
    expect(parseRule("Read")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseRule("")).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(parseRule("   ")).toBeNull();
  });

  it("returns null for a rule with spaces in the tool name", () => {
    expect(parseRule("Read File(**)")).toBeNull();
  });

  it("returns null for a rule missing the tool name", () => {
    expect(parseRule("(**)")).toBeNull();
  });

  it("treats re: with nothing after as a regex with empty source", () => {
    const result = parseRule("Bash(re:)");
    expect(result).toEqual({
      toolPattern: "Bash",
      inputPattern: "",
      isRegex: true,
    });
  });

  it("parses a path-based glob rule", () => {
    const result = parseRule("Write(/etc/**)");
    expect(result).toEqual({
      toolPattern: "Write",
      inputPattern: "/etc/**",
      isRegex: false,
    });
  });
});

// ---------------------------------------------------------------------------
// matchRule – glob matching
// ---------------------------------------------------------------------------
describe("matchRule – glob matching", () => {
  it("matches exact input", () => {
    expect(matchRule("Bash(npm test)", "Bash", "npm test")).toBe(true);
  });

  it("does not match different input", () => {
    expect(matchRule("Bash(npm test)", "Bash", "npm install")).toBe(false);
  });

  it("matches ** against any path", () => {
    expect(matchRule("Read(**)", "Read", "/home/user/file.txt")).toBe(true);
  });

  it("matches ** against empty string", () => {
    expect(matchRule("Read(**)", "Read", "")).toBe(true);
  });

  it("matches ** against deeply nested paths", () => {
    expect(matchRule("Read(**)", "Read", "/a/b/c/d/e/f.txt")).toBe(true);
  });

  it("matches single * against a path segment without slashes", () => {
    expect(matchRule("Bash(npm *)", "Bash", "npm test")).toBe(true);
  });

  it("single * does not match across slashes", () => {
    expect(matchRule("Read(/src/*)", "Read", "/src/a/b.ts")).toBe(false);
  });

  it("single * matches a single path segment", () => {
    expect(matchRule("Read(/src/*)", "Read", "/src/file.ts")).toBe(true);
  });

  it("matches ? against a single non-slash character", () => {
    expect(matchRule("Bash(git ?)", "Bash", "git a")).toBe(true);
  });

  it("? does not match a slash", () => {
    expect(matchRule("Read(/src/?)", "Read", "/src//")).toBe(false);
  });

  it("? does not match empty", () => {
    expect(matchRule("Read(/src/?.ts)", "Read", "/src/.ts")).toBe(false);
  });

  it("? matches exactly one character", () => {
    expect(matchRule("Read(/src/?.ts)", "Read", "/src/a.ts")).toBe(true);
  });

  it("escapes regex-special characters in glob patterns", () => {
    // The dot in "file.txt" should be literal, not a regex wildcard.
    expect(matchRule("Read(file.txt)", "Read", "file.txt")).toBe(true);
    expect(matchRule("Read(file.txt)", "Read", "fileXtxt")).toBe(false);
  });

  it("escapes $ in glob patterns", () => {
    expect(matchRule("Bash(echo $HOME)", "Bash", "echo $HOME")).toBe(true);
    expect(matchRule("Bash(echo $HOME)", "Bash", "echo XHOME")).toBe(false);
  });

  it("escapes + in glob patterns", () => {
    expect(matchRule("Bash(a+b)", "Bash", "a+b")).toBe(true);
  });

  it("escapes ^ in glob patterns", () => {
    expect(matchRule("Bash(^start)", "Bash", "^start")).toBe(true);
  });

  it("escapes brackets in glob patterns", () => {
    expect(matchRule("Read([test])", "Read", "[test]")).toBe(true);
  });

  it("matches a path prefix with /**", () => {
    expect(matchRule("Write(/etc/**)", "Write", "/etc/passwd")).toBe(true);
    expect(matchRule("Write(/etc/**)", "Write", "/etc/shadow")).toBe(true);
    expect(matchRule("Write(/etc/**)", "Write", "/etc/ssl/cert.pem")).toBe(true);
  });

  it("does not match a different prefix with /**", () => {
    expect(matchRule("Write(/etc/**)", "Write", "/var/log/syslog")).toBe(false);
  });

  it("matches combined * and ** glob", () => {
    // /src/**/*.ts requires at least one subdirectory (** needs a / to cross).
    expect(matchRule("Read(/src/**/*.ts)", "Read", "/src/a/b/c.ts")).toBe(true);
    expect(matchRule("Read(/src/**/*.ts)", "Read", "/src/a/c.ts")).toBe(true);
  });

  it("combined * and ** glob does not match without intermediate directory", () => {
    // /src/**/*.ts has a literal / between ** and *, so /src/c.ts lacks it.
    expect(matchRule("Read(/src/**/*.ts)", "Read", "/src/c.ts")).toBe(false);
  });

  it("does not match wrong extension with combined glob", () => {
    expect(matchRule("Read(/src/**/*.ts)", "Read", "/src/a/b.js")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchRule – regex matching
// ---------------------------------------------------------------------------
describe("matchRule – regex matching", () => {
  it("matches a regex pattern", () => {
    expect(matchRule("Bash(re:^git\\s.*)", "Bash", "git status")).toBe(true);
  });

  it("does not match a non-matching regex", () => {
    expect(matchRule("Bash(re:^git\\s.*)", "Bash", "npm install")).toBe(false);
  });

  it("matches regex with character classes", () => {
    expect(matchRule("Bash(re:^npm\\s+(test|build)$)", "Bash", "npm test")).toBe(true);
    expect(matchRule("Bash(re:^npm\\s+(test|build)$)", "Bash", "npm build")).toBe(true);
    expect(matchRule("Bash(re:^npm\\s+(test|build)$)", "Bash", "npm publish")).toBe(false);
  });

  it("matches regex with .* wildcard", () => {
    expect(matchRule("*(re:.*secret.*)", "Read", "path/to/secret/file")).toBe(true);
    expect(matchRule("*(re:.*secret.*)", "Write", "no-hidden-here")).toBe(false);
  });

  it("returns false for an invalid regex", () => {
    // Unbalanced bracket → invalid regex → matchRule returns false.
    expect(matchRule("Bash(re:[invalid)", "Bash", "anything")).toBe(false);
  });

  it("matches an empty regex against any input", () => {
    // Empty regex always matches.
    expect(matchRule("Bash(re:)", "Bash", "anything")).toBe(true);
    expect(matchRule("Bash(re:)", "Bash", "")).toBe(true);
  });

  it("regex partial match (not anchored by default)", () => {
    // Without ^ and $, regex does partial matching.
    expect(matchRule("Bash(re:git)", "Bash", "my git command")).toBe(true);
  });

  it("anchored regex requires full match", () => {
    expect(matchRule("Bash(re:^git$)", "Bash", "git")).toBe(true);
    expect(matchRule("Bash(re:^git$)", "Bash", "git status")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchRule – tool name matching
// ---------------------------------------------------------------------------
describe("matchRule – tool name matching", () => {
  it("matches exact tool name", () => {
    expect(matchRule("Read(**)", "Read", "/any/path")).toBe(true);
  });

  it("does not match different tool name", () => {
    expect(matchRule("Read(**)", "Write", "/any/path")).toBe(false);
  });

  it("wildcard * matches any tool name", () => {
    expect(matchRule("*(**)", "Read", "/any/path")).toBe(true);
    expect(matchRule("*(**)", "Write", "/any/path")).toBe(true);
    expect(matchRule("*(**)", "Bash", "ls -la")).toBe(true);
  });

  it("wildcard * with specific input pattern", () => {
    expect(matchRule("*(re:.*secret.*)", "Read", "secret.txt")).toBe(true);
    expect(matchRule("*(re:.*secret.*)", "Write", "secret.txt")).toBe(true);
    expect(matchRule("*(re:.*secret.*)", "Bash", "cat secret.txt")).toBe(true);
  });

  it("tool name matching is case-sensitive", () => {
    expect(matchRule("Read(**)", "read", "/any/path")).toBe(false);
    expect(matchRule("read(**)", "Read", "/any/path")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchRule – malformed rules
// ---------------------------------------------------------------------------
describe("matchRule – malformed rules", () => {
  it("returns false for a rule without parentheses", () => {
    expect(matchRule("Read", "Read", "/any/path")).toBe(false);
  });

  it("returns false for an empty rule", () => {
    expect(matchRule("", "Read", "/any/path")).toBe(false);
  });

  it("returns false for a whitespace-only rule", () => {
    expect(matchRule("   ", "Read", "/any/path")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchAny
// ---------------------------------------------------------------------------
describe("matchAny", () => {
  it("returns false for an empty rule list", () => {
    expect(matchAny([], "Read", "/any/path")).toBe(false);
  });

  it("returns true when the first rule matches", () => {
    const rules = ["Read(**)", "Write(**)"];
    expect(matchAny(rules, "Read", "/any/path")).toBe(true);
  });

  it("returns true when a later rule matches", () => {
    const rules = ["Write(**)", "Bash(npm test)", "Read(**)"];
    expect(matchAny(rules, "Read", "/any/path")).toBe(true);
  });

  it("returns false when no rules match", () => {
    const rules = ["Write(**)", "Bash(npm test)"];
    expect(matchAny(rules, "Read", "/any/path")).toBe(false);
  });

  it("short-circuits on the first match", () => {
    // Even though the second rule also matches, the first one should suffice.
    const rules = ["Read(**)", "Read(/specific/path)"];
    expect(matchAny(rules, "Read", "/specific/path")).toBe(true);
  });

  it("skips malformed rules and matches valid ones", () => {
    const rules = ["malformed", "Read(**)"];
    expect(matchAny(rules, "Read", "/any/path")).toBe(true);
  });

  it("returns false when all rules are malformed", () => {
    const rules = ["no-parens", "also-bad", ""];
    expect(matchAny(rules, "Read", "/any/path")).toBe(false);
  });

  it("handles a mix of glob and regex rules", () => {
    const rules = [
      "Bash(re:^git\\s.*)",
      "Read(/src/**/*.ts)",
      "Write(/tmp/**)",
    ];
    expect(matchAny(rules, "Bash", "git commit")).toBe(true);
    expect(matchAny(rules, "Read", "/src/a/b.ts")).toBe(true);
    expect(matchAny(rules, "Write", "/tmp/test.txt")).toBe(true);
    expect(matchAny(rules, "Bash", "npm install")).toBe(false);
  });

  it("wildcard tool rules match across tools", () => {
    const rules = ["*(re:.*\\.env.*)"];
    expect(matchAny(rules, "Read", "/app/.env")).toBe(true);
    expect(matchAny(rules, "Write", "/app/.env.local")).toBe(true);
    expect(matchAny(rules, "Bash", "cat .env")).toBe(true);
    expect(matchAny(rules, "Read", "/app/config.json")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// globMatch edge cases (tested indirectly through matchRule)
// ---------------------------------------------------------------------------
describe("glob edge cases", () => {
  it("empty glob matches empty string", () => {
    expect(matchRule("Bash()", "Bash", "")).toBe(true);
  });

  it("empty glob does not match non-empty string", () => {
    expect(matchRule("Bash()", "Bash", "something")).toBe(false);
  });

  it("backslash is escaped in glob", () => {
    // One literal backslash in the glob → escaped in regex → matches one backslash.
    expect(matchRule("Read(C:\\Users)", "Read", "C:\\Users")).toBe(true);
    expect(matchRule("Read(C:\\Users)", "Read", "C::Users")).toBe(false);
  });

  it("curly braces are escaped in glob", () => {
    expect(matchRule("Bash(echo {a,b})", "Bash", "echo {a,b}")).toBe(true);
  });

  it("pipe is escaped in glob", () => {
    expect(matchRule("Bash(a|b)", "Bash", "a|b")).toBe(true);
    expect(matchRule("Bash(a|b)", "Bash", "a")).toBe(false);
  });

  it("multiple ? in sequence", () => {
    expect(matchRule("Read(???.ts)", "Read", "abc.ts")).toBe(true);
    expect(matchRule("Read(???.ts)", "Read", "ab.ts")).toBe(false);
    expect(matchRule("Read(???.ts)", "Read", "abcd.ts")).toBe(false);
  });

  it("* at the beginning of a pattern", () => {
    expect(matchRule("Bash(*.sh)", "Bash", "run.sh")).toBe(true);
    expect(matchRule("Bash(*.sh)", "Bash", "run.bash")).toBe(false);
  });

  it("multiple * segments", () => {
    expect(matchRule("Read(*/*.ts)", "Read", "src/index.ts")).toBe(true);
    expect(matchRule("Read(*/*.ts)", "Read", "src/deep/index.ts")).toBe(false);
  });
});
