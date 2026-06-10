import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryManager } from "../../../src/core/memory/memoryManager.js";

describe("createMemoryManager", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "onicode-mem-test-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("path() returns correct file path", () => {
    const mgr = createMemoryManager(cwd);
    expect(mgr.path()).toBe(join(cwd, ".onicode", "memory.md"));
  });

  it("load() returns null when file doesn't exist", async () => {
    const mgr = createMemoryManager(cwd);
    const result = await mgr.load();
    expect(result).toBeNull();
  });

  it("save() + load() round-trip", async () => {
    const mgr = createMemoryManager(cwd);
    await mgr.save("# My Memory\n\n- item one\n- item two\n");
    const result = await mgr.load();
    expect(result).toBe("# My Memory\n\n- item one\n- item two\n");
  });

  it("save() creates .onicode/ directory if missing", async () => {
    const mgr = createMemoryManager(cwd);
    await mgr.save("test content");
    // Verify by reading the file directly.
    const content = await readFile(join(cwd, ".onicode", "memory.md"), "utf-8");
    expect(content).toBe("test content");
  });

  it("append() adds to existing content", async () => {
    const mgr = createMemoryManager(cwd);
    await mgr.save("# Project Memory\n\n- first\n");
    await mgr.append("- second");
    const result = await mgr.load();
    expect(result).toBe("# Project Memory\n\n- first\n- second\n");
  });

  it("append() creates file with default header when none exists", async () => {
    const mgr = createMemoryManager(cwd);
    await mgr.append("- first entry");
    const result = await mgr.load();
    expect(result).toBe("# Project Memory\n\n- first entry\n");
  });

  it("append() adds newline separator when content doesn't end with one", async () => {
    const mgr = createMemoryManager(cwd);
    await mgr.save("# No trailing newline");
    await mgr.append("- entry");
    const result = await mgr.load();
    expect(result).toBe("# No trailing newline\n- entry\n");
  });

  it("clear() resets to template", async () => {
    const mgr = createMemoryManager(cwd);
    await mgr.save("lots of important stuff");
    await mgr.clear();
    const result = await mgr.load();
    expect(result).toBe("# Project Memory\n\n_No entries yet._\n");
  });

  it("multiple appends accumulate", async () => {
    const mgr = createMemoryManager(cwd);
    await mgr.append("- one");
    await mgr.append("- two");
    await mgr.append("- three");
    const result = await mgr.load();
    expect(result).toContain("- one");
    expect(result).toContain("- two");
    expect(result).toContain("- three");
  });
});
