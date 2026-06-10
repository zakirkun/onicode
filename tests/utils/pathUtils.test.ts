import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import {
  expandHome,
  resolveAgainst,
  ensureDir,
  userRootDir,
  userConfigPath,
  userSessionDir,
  userSkillDir,
  projectConfigPath,
  projectSkillDir,
  USER_DIR_NAME,
} from "../../src/utils/pathUtils.js";

describe("expandHome", () => {
  it("expands ~ to home directory", () => {
    expect(expandHome("~")).toBe(homedir());
  });

  it("expands ~/path to home/path", () => {
    const result = expandHome("~/some/path");
    expect(result).toBe(path.join(homedir(), "some/path"));
  });

  it("expands ~\\path on Windows-style paths", () => {
    const result = expandHome("~\\some\\path");
    expect(result).toBe(path.join(homedir(), "some\\path"));
  });

  it("returns path unchanged if it doesn't start with ~", () => {
    expect(expandHome("/absolute/path")).toBe("/absolute/path");
    expect(expandHome("relative/path")).toBe("relative/path");
    expect(expandHome("")).toBe("");
  });

  it("is idempotent", () => {
    const expanded = expandHome("~/test");
    expect(expandHome(expanded)).toBe(expanded);
  });
});

describe("resolveAgainst", () => {
  const base = "/base/dir";

  it("joins relative paths with base", () => {
    const result = resolveAgainst(base, "file.txt");
    expect(result).toBe(path.normalize(path.resolve(base, "file.txt")));
  });

  it("returns absolute paths unchanged", () => {
    const absolutePath = path.normalize("/absolute/path/file.txt");
    expect(resolveAgainst(base, "/absolute/path/file.txt")).toBe(absolutePath);
  });

  it("expands ~ before resolving", () => {
    const result = resolveAgainst(base, "~/file.txt");
    expect(result).toBe(path.normalize(path.join(homedir(), "file.txt")));
  });

  it("normalizes paths", () => {
    const result = resolveAgainst(base, "./subdir/../file.txt");
    expect(result).toBe(path.normalize(path.resolve(base, "file.txt")));
  });
});

describe("ensureDir", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      homedir(),
      ".onicode-test-" + Date.now() + "-" + Math.random().toString(36).slice(2)
    );
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("creates a new directory", async () => {
    await ensureDir(tmpDir);
    const stats = await stat(tmpDir);
    expect(stats.isDirectory()).toBe(true);
  });

  it("creates nested directories", async () => {
    const nested = path.join(tmpDir, "a", "b", "c");
    await ensureDir(nested);
    const stats = await stat(nested);
    expect(stats.isDirectory()).toBe(true);
  });

  it("is idempotent", async () => {
    await ensureDir(tmpDir);
    await ensureDir(tmpDir); // should not throw
    const stats = await stat(tmpDir);
    expect(stats.isDirectory()).toBe(true);
  });
});

describe("userRootDir", () => {
  it("returns ~/.onicode", () => {
    expect(userRootDir()).toBe(path.join(homedir(), USER_DIR_NAME));
  });
});

describe("userConfigPath", () => {
  it("returns ~/.onicode/config.json", () => {
    expect(userConfigPath()).toBe(
      path.join(homedir(), USER_DIR_NAME, "config.json")
    );
  });
});

describe("userSessionDir", () => {
  it("returns ~/.onicode/sessions", () => {
    expect(userSessionDir()).toBe(
      path.join(homedir(), USER_DIR_NAME, "sessions")
    );
  });
});

describe("userSkillDir", () => {
  it("returns ~/.onicode/skills", () => {
    expect(userSkillDir()).toBe(
      path.join(homedir(), USER_DIR_NAME, "skills")
    );
  });
});

describe("projectConfigPath", () => {
  it("returns <cwd>/onicode.config.json", () => {
    const cwd = "/some/project";
    expect(projectConfigPath(cwd)).toBe(
      path.join(cwd, "onicode.config.json")
    );
  });
});

describe("projectSkillDir", () => {
  it("returns <cwd>/.onicode/skills", () => {
    const cwd = "/some/project";
    expect(projectSkillDir(cwd)).toBe(path.join(cwd, USER_DIR_NAME, "skills"));
  });
});
