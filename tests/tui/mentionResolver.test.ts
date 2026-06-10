/**
 * Tests for @-mention resolver.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  resolveMention,
  findMentions,
  expandMentions,
} from "../../src/tui/mentionResolver.js";

const TEST_DIR = join(process.cwd(), ".test-mention-fixture");

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveMention
// ---------------------------------------------------------------------------
describe("resolveMention", () => {
  it("returns top-level files when query is empty", async () => {
    await writeFile(join(TEST_DIR, "foo.ts"), "");
    await writeFile(join(TEST_DIR, "bar.ts"), "");
    const results = await resolveMention("", { cwd: TEST_DIR });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.path).sort()).toEqual(["bar.ts", "foo.ts"]);
  });

  it("matches files by partial name (case-insensitive)", async () => {
    await writeFile(join(TEST_DIR, "message.ts"), "");
    await writeFile(join(TEST_DIR, "agent.ts"), "");
    const results = await resolveMention("age", { cwd: TEST_DIR });
    expect(results).toHaveLength(2); // both "message" and "agent" contain "age"
    expect(results.some((r) => r.path === "agent.ts")).toBe(true);
  });

  it("matches directories and appends separator", async () => {
    await mkdir(join(TEST_DIR, "components"));
    await writeFile(join(TEST_DIR, "components", "App.tsx"), "");
    const results = await resolveMention("comp", { cwd: TEST_DIR });
    expect(results.some((r) => r.isDir && r.path === `components${sep}`)).toBe(true);
  });

  it("respects maxDepth", async () => {
    await mkdir(join(TEST_DIR, "a", "b", "c", "d", "e"), { recursive: true });
    await writeFile(join(TEST_DIR, "a", "b", "c", "d", "e", "deep.ts"), "");
    const results = await resolveMention("deep", { cwd: TEST_DIR, maxDepth: 2 });
    expect(results).toHaveLength(0);
  });

  it("respects maxResults", async () => {
    for (let i = 0; i < 30; i++) {
      await writeFile(join(TEST_DIR, `file${i}.ts`), "");
    }
    const results = await resolveMention("", { cwd: TEST_DIR, maxResults: 10 });
    expect(results).toHaveLength(10);
  });

  it("applies ignorePatterns", async () => {
    await mkdir(join(TEST_DIR, "node_modules"));
    await writeFile(join(TEST_DIR, "node_modules", "dep.ts"), "");
    const results = await resolveMention("dep", { cwd: TEST_DIR });
    expect(results).toHaveLength(0);
  });

  it("ignores dotfiles by default", async () => {
    await writeFile(join(TEST_DIR, ".hidden"), "");
    const results = await resolveMention("hidden", { cwd: TEST_DIR });
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findMentions
// ---------------------------------------------------------------------------
describe("findMentions", () => {
  it("returns empty array when no mentions", () => {
    expect(findMentions("hello world")).toEqual([]);
  });

  it("finds single mention", () => {
    const result = findMentions("read @src/foo.ts please");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ start: 5, end: 16, query: "src/foo.ts" });
  });

  it("finds multiple mentions", () => {
    const result = findMentions("compare @a.ts and @b.ts");
    expect(result).toHaveLength(2);
    expect(result[0]!.query).toBe("a.ts");
    expect(result[1]!.query).toBe("b.ts");
  });

  it("handles mention at start", () => {
    const result = findMentions("@foo.ts is broken");
    expect(result).toHaveLength(1);
    expect(result[0]!.start).toBe(0);
  });

  it("handles mention at end", () => {
    const result = findMentions("check @foo.ts");
    expect(result).toHaveLength(1);
    expect(result[0]!.query).toBe("foo.ts");
  });

  it("handles empty mention (@ with no query)", () => {
    const result = findMentions("type @ here");
    expect(result).toHaveLength(1);
    expect(result[0]!.query).toBe("");
  });
});

// ---------------------------------------------------------------------------
// expandMentions
// ---------------------------------------------------------------------------
describe("expandMentions", () => {
  it("returns text unchanged when no mentions", async () => {
    const result = await expandMentions("hello world", TEST_DIR);
    expect(result.expanded).toBe("hello world");
    expect(result.files).toEqual([]);
  });

  it("injects file content for existing file", async () => {
    await writeFile(join(TEST_DIR, "test.txt"), "file content here");
    const result = await expandMentions("read @test.txt now", TEST_DIR);
    expect(result.expanded).toContain("<file path=\"test.txt\">");
    expect(result.expanded).toContain("file content here");
    expect(result.files).toEqual(["test.txt"]);
  });

  it("leaves @mention as-is when file not found", async () => {
    const result = await expandMentions("read @missing.txt now", TEST_DIR);
    expect(result.expanded).toBe("read @missing.txt now");
    expect(result.files).toEqual([]);
  });

  it("handles multiple mentions in reverse order", async () => {
    await writeFile(join(TEST_DIR, "a.txt"), "AAA");
    await writeFile(join(TEST_DIR, "b.txt"), "BBB");
    const result = await expandMentions("@a.txt and @b.txt", TEST_DIR);
    expect(result.expanded).toContain("AAA");
    expect(result.expanded).toContain("BBB");
    expect(result.files).toHaveLength(2);
  });
});
