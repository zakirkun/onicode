/**
 * Config loader tests.
 *
 * Validates the three-source merge logic (defaults → user → project),
 * including missing-file tolerance, malformed JSON, schema validation,
 * deep merge semantics, and home-directory expansion.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../../src/config/loader.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { OnicodeConfig } from "../../src/config/types.js";

/**
 * Helper: write a JSON file at the given path. Creates parent dirs if needed.
 */
async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data), "utf8");
}

/**
 * Helper: write raw text to a file. Creates parent dirs if needed.
 */
async function writeRaw(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "onicode-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Paths for config files within the temp directory.
   * We use separate subdirectories to mirror real layout (user vs project).
   */
  function userPath(): string {
    return path.join(tempDir, "user", "config.json");
  }
  function projectPath(): string {
    return path.join(tempDir, "project", "onicode.config.json");
  }
  function projectCwd(): string {
    return path.join(tempDir, "project");
  }

  // ─── Default config ────────────────────────────────────────────────

  it("returns defaults when no config files exist", async () => {
    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(config.defaultProvider).toBe(DEFAULT_CONFIG.defaultProvider);
    expect(config.defaultModel).toBe(DEFAULT_CONFIG.defaultModel);
    expect(config.permissions.mode).toBe(DEFAULT_CONFIG.permissions.mode);
    expect(config.permissions.allow).toEqual(DEFAULT_CONFIG.permissions.allow);
    expect(config.permissions.deny).toEqual(DEFAULT_CONFIG.permissions.deny);
    expect(config.coordinator.maxConcurrentSubAgents).toBe(
      DEFAULT_CONFIG.coordinator.maxConcurrentSubAgents,
    );
    expect(config.mcpServers).toEqual({});
    expect(config.providers).toEqual(DEFAULT_CONFIG.providers);
  });

  // ─── User config ──────────────────────────────────────────────────

  it("merges user config over defaults", async () => {
    await writeJson(userPath(), {
      defaultModel: "gpt-4o",
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(config.defaultModel).toBe("gpt-4o");
    // Other fields still come from defaults.
    expect(config.defaultProvider).toBe(DEFAULT_CONFIG.defaultProvider);
    expect(config.permissions.mode).toBe(DEFAULT_CONFIG.permissions.mode);
  });

  it("user config deep-merges nested objects", async () => {
    await writeJson(userPath(), {
      coordinator: { maxConcurrentSubAgents: 5 },
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(config.coordinator.maxConcurrentSubAgents).toBe(5);
    // Permissions untouched.
    expect(config.permissions.mode).toBe(DEFAULT_CONFIG.permissions.mode);
  });

  // ─── Project config ───────────────────────────────────────────────

  it("merges project config over user + defaults", async () => {
    await writeJson(userPath(), {
      defaultModel: "gpt-4o",
    });
    await writeJson(projectPath(), {
      defaultModel: "claude-opus-4-20250514",
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    // Project wins over user.
    expect(config.defaultModel).toBe("claude-opus-4-20250514");
  });

  it("project config overrides deep-merged fields", async () => {
    await writeJson(userPath(), {
      permissions: { mode: "plan", allow: ["Read(**)"] },
    });
    await writeJson(projectPath(), {
      permissions: { mode: "bypassPermissions" },
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    // Project overrides mode; user's allow list is preserved via deep merge.
    expect(config.permissions.mode).toBe("bypassPermissions");
    expect(config.permissions.allow).toEqual(["Read(**)"]);
  });

  // ─── Precedence: later sources override earlier ───────────────────

  it("later sources override earlier (full chain)", async () => {
    await writeJson(userPath(), {
      defaultProvider: "openai",
      defaultModel: "gpt-4o",
      logLevel: "debug",
    });
    await writeJson(projectPath(), {
      defaultModel: "claude-opus-4-20250514",
      logLevel: "warn",
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    // defaultProvider: only user set it → user wins.
    expect(config.defaultProvider).toBe("openai");
    // defaultModel: both set it → project wins.
    expect(config.defaultModel).toBe("claude-opus-4-20250514");
    // logLevel: both set it → project wins.
    expect(config.logLevel).toBe("warn");
  });

  it("arrays are replaced wholesale, not concatenated", async () => {
    await writeJson(userPath(), {
      permissions: { allow: ["Read(**)", "Bash(re:^git\\s.*)"] },
    });
    await writeJson(projectPath(), {
      permissions: { allow: ["Read(**)"] },
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    // Project's array replaces user's — not merged.
    expect(config.permissions.allow).toEqual(["Read(**)"]);
  });

  // ─── Malformed JSON ───────────────────────────────────────────────

  it("throws on malformed JSON in user config", async () => {
    await writeRaw(userPath(), "{ this is not valid json }}}");

    await expect(
      loadConfig({
        cwd: projectCwd(),
        userConfigPath: userPath(),
        projectConfigPath: projectPath(),
      }),
    ).rejects.toThrow(/Invalid JSON in user config/);
  });

  it("throws on malformed JSON in project config", async () => {
    await writeRaw(projectPath(), "<<<not json>>>");

    await expect(
      loadConfig({
        cwd: projectCwd(),
        userConfigPath: userPath(),
        projectConfigPath: projectPath(),
      }),
    ).rejects.toThrow(/Invalid JSON in project config/);
  });

  // ─── Schema validation ────────────────────────────────────────────

  it("throws on invalid schema in user config", async () => {
    await writeJson(userPath(), {
      defaultProvider: "nonexistent-provider",
    });

    await expect(
      loadConfig({
        cwd: projectCwd(),
        userConfigPath: userPath(),
        projectConfigPath: projectPath(),
      }),
    ).rejects.toThrow(/Invalid user config/);
  });

  it("throws on invalid schema in project config", async () => {
    await writeJson(projectPath(), {
      coordinator: { maxConcurrentSubAgents: -5 },
    });

    await expect(
      loadConfig({
        cwd: projectCwd(),
        userConfigPath: userPath(),
        projectConfigPath: projectPath(),
      }),
    ).rejects.toThrow(/Invalid project config/);
  });

  // ─── Missing files ────────────────────────────────────────────────

  it("does not error when user config is missing", async () => {
    // userPath does not exist.
    await writeJson(projectPath(), { defaultModel: "gpt-4o" });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(config.defaultModel).toBe("gpt-4o");
  });

  it("does not error when project config is missing", async () => {
    // projectPath does not exist.
    await writeJson(userPath(), { defaultModel: "gpt-4o" });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(config.defaultModel).toBe("gpt-4o");
  });

  it("does not error when both config files are missing", async () => {
    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(config.defaultProvider).toBe(DEFAULT_CONFIG.defaultProvider);
  });

  // ─── Home expansion ───────────────────────────────────────────────

  it("expands ~ in session.dir", async () => {
    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    // The default is "~/.onicode/sessions" — should be expanded to an
    // absolute path without a leading `~`.
    expect(config.session.dir).not.toMatch(/^~/);
    expect(path.isAbsolute(config.session.dir)).toBe(true);
  });

  it("expands ~ in session.dir when overridden by user config", async () => {
    await writeJson(userPath(), {
      session: { dir: "~/custom-sessions" },
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(config.session.dir).not.toMatch(/^~/);
    expect(config.session.dir).toContain("custom-sessions");
  });

  // ─── Provider config merge ────────────────────────────────────────

  it("deep-merges provider config without losing sibling providers", async () => {
    await writeJson(userPath(), {
      providers: {
        openai: { apiKeyEnv: "MY_OPENAI_KEY" },
      },
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    // User override applied.
    expect(config.providers.openai.apiKeyEnv).toBe("MY_OPENAI_KEY");
    // Sibling providers from defaults still present.
    expect(config.providers.anthropic.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
    expect(config.providers.ollama.baseUrl).toBe("http://localhost:11434/v1");
  });

  // ─── MCP servers ──────────────────────────────────────────────────

  it("merges mcpServers from project config", async () => {
    await writeJson(projectPath(), {
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
          env: { ALLOWED_DIR: "/tmp" },
        },
      },
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(config.mcpServers.filesystem).toBeDefined();
    expect(config.mcpServers.filesystem.command).toBe("npx");
    expect(config.mcpServers.filesystem.args).toContain(
      "@modelcontextprotocol/server-filesystem",
    );
  });

  // ─── Empty config files ───────────────────────────────────────────

  it("treats an empty JSON object as a valid partial", async () => {
    await writeJson(userPath(), {});
    await writeJson(projectPath(), {});

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(config.defaultProvider).toBe(DEFAULT_CONFIG.defaultProvider);
    expect(config.defaultModel).toBe(DEFAULT_CONFIG.defaultModel);
  });

  // ─── Returned config is fully validated ──────────────────────────────

  it("returns a config matching OnicodeConfigSchema", async () => {
    await writeJson(userPath(), {
      defaultProvider: "openai",
      permissions: { mode: "acceptEdits", deny: ["Write(/etc/**)"] },
    });
    await writeJson(projectPath(), {
      coordinator: { maxConcurrentSubAgents: 10 },
    });

    const config = await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    // All required top-level keys present.
    expect(config).toHaveProperty("defaultProvider");
    expect(config).toHaveProperty("defaultModel");
    expect(config).toHaveProperty("providers");
    expect(config).toHaveProperty("permissions");
    expect(config).toHaveProperty("mcpServers");
    expect(config).toHaveProperty("session");
    expect(config).toHaveProperty("coordinator");

    // Specific overrides applied.
    expect(config.defaultProvider).toBe("openai");
    expect(config.permissions.mode).toBe("acceptEdits");
    expect(config.permissions.deny).toEqual(["Write(/etc/**)"]);
    expect(config.coordinator.maxConcurrentSubAgents).toBe(10);
  });

  // ─── Defaults are not mutated ─────────────────────────────────────

  it("does not mutate DEFAULT_CONFIG after loading with overrides", async () => {
    const originalModel = DEFAULT_CONFIG.defaultModel;
    const originalMode = DEFAULT_CONFIG.permissions.mode;

    await writeJson(userPath(), {
      defaultModel: "totally-different-model",
      permissions: { mode: "bypassPermissions" },
    });

    await loadConfig({
      cwd: projectCwd(),
      userConfigPath: userPath(),
      projectConfigPath: projectPath(),
    });

    expect(DEFAULT_CONFIG.defaultModel).toBe(originalModel);
    expect(DEFAULT_CONFIG.permissions.mode).toBe(originalMode);
  });
});
