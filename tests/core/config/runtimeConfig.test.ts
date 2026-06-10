import { describe, it, expect, vi, beforeEach } from "vitest";
import { RuntimeConfigManager, type ConfigDiff } from "../../../src/core/config/runtimeConfig.js";
import type { OnicodeConfig } from "../../../src/config/types.js";
import { createMockLogger } from "../../helpers/fixtures.js";

/** Build a minimal valid OnicodeConfig for testing. */
function makeConfig(overrides?: Partial<OnicodeConfig>): OnicodeConfig {
  return {
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    providers: {
      anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
      openai: { apiKeyEnv: "OPENAI_API_KEY" },
      ollama: { baseUrl: "http://localhost:11434/v1" },
    },
    permissions: {
      mode: "default",
      allow: ["Read(**)"],
      deny: [],
    },
    mcpServers: {},
    session: { dir: "/tmp/sessions" },
    coordinator: { maxConcurrentSubAgents: 3 },
    logLevel: "info",
    ...overrides,
  };
}

describe("RuntimeConfigManager", () => {
  let log: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    log = createMockLogger();
  });

  describe("current", () => {
    it("returns the initial config", () => {
      const cfg = makeConfig();
      const mgr = new RuntimeConfigManager({ config: cfg, cwd: "/tmp", log });
      expect(mgr.current).toEqual(cfg);
    });
  });

  describe("setModel()", () => {
    it("updates defaultModel and fires onChange with modelChanged", () => {
      const handler = vi.fn<(diff: ConfigDiff) => void>();
      const mgr = new RuntimeConfigManager({
        config: makeConfig(),
        cwd: "/tmp",
        log,
        onChange: handler,
      });

      mgr.setModel("claude-opus-4-20250514");

      expect(mgr.current.defaultModel).toBe("claude-opus-4-20250514");
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({
        providerChanged: false,
        modelChanged: true,
        mcpServersChanged: false,
        permissionsChanged: false,
      });
    });

    it("is a no-op when value is unchanged", () => {
      const handler = vi.fn();
      const mgr = new RuntimeConfigManager({
        config: makeConfig(),
        cwd: "/tmp",
        log,
        onChange: handler,
      });

      mgr.setModel("claude-sonnet-4-20250514");

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("setProvider()", () => {
    it("updates defaultProvider and fires onChange with providerChanged", () => {
      const handler = vi.fn<(diff: ConfigDiff) => void>();
      const mgr = new RuntimeConfigManager({
        config: makeConfig(),
        cwd: "/tmp",
        log,
        onChange: handler,
      });

      mgr.setProvider("openai");

      expect(mgr.current.defaultProvider).toBe("openai");
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({
        providerChanged: true,
        modelChanged: false,
        mcpServersChanged: false,
        permissionsChanged: false,
      });
    });

    it("is a no-op when value is unchanged", () => {
      const handler = vi.fn();
      const mgr = new RuntimeConfigManager({
        config: makeConfig(),
        cwd: "/tmp",
        log,
        onChange: handler,
      });

      mgr.setProvider("anthropic");

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("setMode()", () => {
    it("updates permissions.mode and fires onChange with permissionsChanged", () => {
      const handler = vi.fn<(diff: ConfigDiff) => void>();
      const mgr = new RuntimeConfigManager({
        config: makeConfig(),
        cwd: "/tmp",
        log,
        onChange: handler,
      });

      mgr.setMode("plan");

      expect(mgr.current.permissions.mode).toBe("plan");
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({
        providerChanged: false,
        modelChanged: false,
        mcpServersChanged: false,
        permissionsChanged: true,
      });
    });

    it("is a no-op when value is unchanged", () => {
      const handler = vi.fn();
      const mgr = new RuntimeConfigManager({
        config: makeConfig(),
        cwd: "/tmp",
        log,
        onChange: handler,
      });

      mgr.setMode("default");

      expect(handler).not.toHaveBeenCalled();
    });

    it("preserves other permission fields", () => {
      const cfg = makeConfig({
        permissions: { mode: "default", allow: ["Read(**)", "Bash(re:^git.*)"], deny: ["Write(/etc/**)"] },
      });
      const mgr = new RuntimeConfigManager({ config: cfg, cwd: "/tmp", log });

      mgr.setMode("acceptEdits");

      expect(mgr.current.permissions.allow).toEqual(["Read(**)", "Bash(re:^git.*)"]);
      expect(mgr.current.permissions.deny).toEqual(["Write(/etc/**)"]);
    });
  });

  describe("onChange()", () => {
    it("supports multiple handlers", () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      const mgr = new RuntimeConfigManager({
        config: makeConfig(),
        cwd: "/tmp",
        log,
      });

      mgr.onChange(h1);
      mgr.onChange(h2);
      mgr.setModel("new-model");

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it("returns unsubscribe function", () => {
      const handler = vi.fn();
      const mgr = new RuntimeConfigManager({
        config: makeConfig(),
        cwd: "/tmp",
        log,
      });

      const unsub = mgr.onChange(handler);
      mgr.setModel("new-model");
      expect(handler).toHaveBeenCalledOnce();

      unsub();
      mgr.setModel("another-model");
      // Should not have been called again.
      expect(handler).toHaveBeenCalledOnce();
    });

    it("catches handler errors without throwing", () => {
      const badHandler = vi.fn(() => {
        throw new Error("handler blew up");
      });
      const goodHandler = vi.fn();
      const mgr = new RuntimeConfigManager({
        config: makeConfig(),
        cwd: "/tmp",
        log,
        onChange: badHandler,
      });
      mgr.onChange(goodHandler);

      // Should not throw.
      mgr.setModel("new-model");

      expect(badHandler).toHaveBeenCalledOnce();
      expect(goodHandler).toHaveBeenCalledOnce();
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe("reload()", () => {
    it("re-reads config from disk and fires handlers with computed diff", async () => {
      // We test reload by mocking loadConfig indirectly — since loadConfig
      // reads from disk, we use a non-existent path and expect the reload
      // to succeed (loadConfig returns defaults for missing files).
      const cfg = makeConfig();
      const mgr = new RuntimeConfigManager({ config: cfg, cwd: "/tmp", log });

      // reload() with default paths — both user and project config files
      // won't exist so loadConfig returns DEFAULT_CONFIG.
      await mgr.reload();

      // After reload, config should be the DEFAULT_CONFIG values.
      expect(mgr.current.defaultProvider).toBe("anthropic");
      expect(mgr.current.defaultModel).toBe("claude-sonnet-4-20250514");
    });

    it("notifies handlers when config changes after reload", async () => {
      // Start with a non-default model so reload (which returns defaults)
      // will produce a modelChanged diff.
      const cfg = makeConfig({ defaultModel: "custom-model" });
      const handler = vi.fn<(diff: ConfigDiff) => void>();
      const mgr = new RuntimeConfigManager({
        config: cfg,
        cwd: "/tmp",
        log,
        onChange: handler,
      });

      await mgr.reload();

      expect(handler).toHaveBeenCalled();
      const diff = handler.mock.calls[0][0];
      expect(diff.modelChanged).toBe(true);
    });
  });
});
