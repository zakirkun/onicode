/**
 * Config schema validation tests.
 *
 * Tests all exported Zod schemas to ensure they correctly validate,
 * transform, and reject invalid input according to the schema definitions.
 */
import { describe, it, expect } from "vitest";
import {
  ProviderIdSchema,
  PermissionModeSchema,
  ProviderConfigSchema,
  PermissionsConfigSchema,
  McpServerConfigSchema,
  SessionConfigSchema,
  CoordinatorConfigSchema,
  OnicodeConfigSchema,
  PartialOnicodeConfigSchema,
} from "../../src/config/schema.js";

// ─── ProviderIdSchema ────────────────────────────────────────────────────

describe("ProviderIdSchema", () => {
  it.each(["anthropic", "openai", "ollama"] as const)(
    "accepts valid provider id: %s",
    (id) => {
      const result = ProviderIdSchema.safeParse(id);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(id);
      }
    },
  );

  it("rejects unknown provider id", () => {
    const result = ProviderIdSchema.safeParse("gemini");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = ProviderIdSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects null", () => {
    const result = ProviderIdSchema.safeParse(null);
    expect(result.success).toBe(false);
  });

  it("rejects undefined", () => {
    const result = ProviderIdSchema.safeParse(undefined);
    expect(result.success).toBe(false);
  });
});

// ─── PermissionModeSchema ────────────────────────────────────────────────

describe("PermissionModeSchema", () => {
  it.each([
    "default",
    "acceptEdits",
    "plan",
    "bypassPermissions",
  ] as const)("accepts valid mode: %s", (mode) => {
    const result = PermissionModeSchema.safeParse(mode);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(mode);
    }
  });

  it("rejects unknown mode", () => {
    const result = PermissionModeSchema.safeParse("superuser");
    expect(result.success).toBe(false);
  });

  it("rejects empty string", () => {
    const result = PermissionModeSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("is case-sensitive (rejects DEFAULT)", () => {
    const result = PermissionModeSchema.safeParse("DEFAULT");
    expect(result.success).toBe(false);
  });
});

// ─── ProviderConfigSchema ────────────────────────────────────────────────

describe("ProviderConfigSchema", () => {
  it("accepts empty object", () => {
    const result = ProviderConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it("accepts apiKeyEnv only", () => {
    const result = ProviderConfigSchema.safeParse({ apiKeyEnv: "OPENAI_API_KEY" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiKeyEnv).toBe("OPENAI_API_KEY");
    }
  });

  it("accepts baseUrl only", () => {
    const result = ProviderConfigSchema.safeParse({ baseUrl: "http://localhost:11434/v1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baseUrl).toBe("http://localhost:11434/v1");
    }
  });

  it("accepts both apiKeyEnv and baseUrl", () => {
    const result = ProviderConfigSchema.safeParse({
      apiKeyEnv: "MY_KEY",
      baseUrl: "https://api.example.com",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiKeyEnv).toBe("MY_KEY");
      expect(result.data.baseUrl).toBe("https://api.example.com");
    }
  });

  it("rejects empty apiKeyEnv", () => {
    const result = ProviderConfigSchema.safeParse({ apiKeyEnv: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid baseUrl (not a URL)", () => {
    const result = ProviderConfigSchema.safeParse({ baseUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields (strict mode)", () => {
    const result = ProviderConfigSchema.safeParse({
      apiKeyEnv: "KEY",
      unknownField: "value",
    });
    expect(result.success).toBe(false);
  });

  it("rejects null", () => {
    const result = ProviderConfigSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});

// ─── PermissionsConfigSchema ─────────────────────────────────────────────

describe("PermissionsConfigSchema", () => {
  it("accepts valid config with all fields", () => {
    const result = PermissionsConfigSchema.safeParse({
      mode: "default",
      allow: ["Read(**)", "Bash(re:^git\\s.*)"],
      deny: ["Write(/etc/**)"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("default");
      expect(result.data.allow).toHaveLength(2);
      expect(result.data.deny).toHaveLength(1);
    }
  });

  it("defaults allow and deny to empty arrays", () => {
    const result = PermissionsConfigSchema.safeParse({ mode: "plan" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allow).toEqual([]);
      expect(result.data.deny).toEqual([]);
    }
  });

  it("accepts bypassPermissions mode", () => {
    const result = PermissionsConfigSchema.safeParse({ mode: "bypassPermissions" });
    expect(result.success).toBe(true);
  });

  it("accepts acceptEdits mode", () => {
    const result = PermissionsConfigSchema.safeParse({ mode: "acceptEdits" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid mode", () => {
    const result = PermissionsConfigSchema.safeParse({ mode: "invalid-mode" });
    expect(result.success).toBe(false);
  });

  it("rejects missing mode", () => {
    const result = PermissionsConfigSchema.safeParse({ allow: [] });
    expect(result.success).toBe(false);
  });

  it("rejects non-array allow", () => {
    const result = PermissionsConfigSchema.safeParse({
      mode: "default",
      allow: "Read(**)",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string items in allow array", () => {
    const result = PermissionsConfigSchema.safeParse({
      mode: "default",
      allow: [123],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields (strict mode)", () => {
    const result = PermissionsConfigSchema.safeParse({
      mode: "default",
      unknown: true,
    });
    expect(result.success).toBe(false);
  });
});

// ─── McpServerConfigSchema ───────────────────────────────────────────────

describe("McpServerConfigSchema", () => {
  it("accepts valid config with all fields", () => {
    const result = McpServerConfigSchema.safeParse({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      env: { ALLOWED_DIR: "/tmp" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe("npx");
      expect(result.data.args).toHaveLength(2);
      expect(result.data.env?.ALLOWED_DIR).toBe("/tmp");
    }
  });

  it("defaults args to empty array", () => {
    const result = McpServerConfigSchema.safeParse({ command: "node" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.args).toEqual([]);
    }
  });

  it("accepts config without env", () => {
    const result = McpServerConfigSchema.safeParse({
      command: "uvx",
      args: ["my-server"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.env).toBeUndefined();
    }
  });

  it("rejects empty command", () => {
    const result = McpServerConfigSchema.safeParse({ command: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing command", () => {
    const result = McpServerConfigSchema.safeParse({ args: ["foo"] });
    expect(result.success).toBe(false);
  });

  it("rejects non-string args", () => {
    const result = McpServerConfigSchema.safeParse({
      command: "node",
      args: [123],
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string env values", () => {
    const result = McpServerConfigSchema.safeParse({
      command: "node",
      env: { PORT: 3000 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields (strict mode)", () => {
    const result = McpServerConfigSchema.safeParse({
      command: "node",
      timeout: 5000,
    });
    expect(result.success).toBe(false);
  });
});

// ─── SessionConfigSchema ─────────────────────────────────────────────────

describe("SessionConfigSchema", () => {
  it("accepts valid config", () => {
    const result = SessionConfigSchema.safeParse({ dir: "~/.onicode/sessions" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dir).toBe("~/.onicode/sessions");
    }
  });

  it("accepts absolute path", () => {
    const result = SessionConfigSchema.safeParse({ dir: "/var/log/onicode" });
    expect(result.success).toBe(true);
  });

  it("accepts relative path", () => {
    const result = SessionConfigSchema.safeParse({ dir: "./sessions" });
    expect(result.success).toBe(true);
  });

  it("rejects empty dir", () => {
    const result = SessionConfigSchema.safeParse({ dir: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing dir", () => {
    const result = SessionConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields (strict mode)", () => {
    const result = SessionConfigSchema.safeParse({
      dir: "./sessions",
      maxFiles: 100,
    });
    expect(result.success).toBe(false);
  });
});

// ─── CoordinatorConfigSchema ─────────────────────────────────────────────

describe("CoordinatorConfigSchema", () => {
  it("accepts valid config with all fields", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: 5,
      perAgentTokenBudget: 100000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxConcurrentSubAgents).toBe(5);
      expect(result.data.perAgentTokenBudget).toBe(100000);
    }
  });

  it("accepts config without optional perAgentTokenBudget", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: 3,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.perAgentTokenBudget).toBeUndefined();
    }
  });

  it("accepts boundary value: maxConcurrentSubAgents = 1", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts boundary value: maxConcurrentSubAgents = 64", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: 64,
    });
    expect(result.success).toBe(true);
  });

  it("rejects maxConcurrentSubAgents = 0", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative maxConcurrentSubAgents", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects maxConcurrentSubAgents > 64", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: 65,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer maxConcurrentSubAgents", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: 3.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive perAgentTokenBudget", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: 3,
      perAgentTokenBudget: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing maxConcurrentSubAgents", () => {
    const result = CoordinatorConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields (strict mode)", () => {
    const result = CoordinatorConfigSchema.safeParse({
      maxConcurrentSubAgents: 3,
      timeout: 60000,
    });
    expect(result.success).toBe(false);
  });
});

// ─── OnicodeConfigSchema ─────────────────────────────────────────────────

describe("OnicodeConfigSchema", () => {
  const validConfig = {
    defaultProvider: "anthropic" as const,
    defaultModel: "claude-opus-4-20250514",
    providers: {
      anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
      openai: { apiKeyEnv: "OPENAI_API_KEY" },
      ollama: { baseUrl: "http://localhost:11434/v1" },
    },
    permissions: {
      mode: "default" as const,
      allow: [],
      deny: [],
    },
    mcpServers: {},
    session: { dir: "~/.onicode/sessions" },
    coordinator: { maxConcurrentSubAgents: 3 },
  };

  it("accepts fully valid config", () => {
    const result = OnicodeConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("accepts config with optional logLevel", () => {
    const result = OnicodeConfigSchema.safeParse({
      ...validConfig,
      logLevel: "debug",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logLevel).toBe("debug");
    }
  });

  it("accepts all valid logLevel values", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      const result = OnicodeConfigSchema.safeParse({
        ...validConfig,
        logLevel: level,
      });
      expect(result.success).toBe(true);
    }
  });

  it("defaults mcpServers to empty object", () => {
    const configWithoutMcp = { ...validConfig };
    // @ts-expect-error - intentionally omitting mcpServers to test default
    delete configWithoutMcp.mcpServers;
    const result = OnicodeConfigSchema.safeParse(configWithoutMcp);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toEqual({});
    }
  });

  it("accepts config with MCP servers", () => {
    const result = OnicodeConfigSchema.safeParse({
      ...validConfig,
      mcpServers: {
        filesystem: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing defaultProvider", () => {
    const { defaultProvider, ...rest } = validConfig;
    const result = OnicodeConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing defaultModel", () => {
    const { defaultModel, ...rest } = validConfig;
    const result = OnicodeConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing providers", () => {
    const { providers, ...rest } = validConfig;
    const result = OnicodeConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing permissions", () => {
    const { permissions, ...rest } = validConfig;
    const result = OnicodeConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing session", () => {
    const { session, ...rest } = validConfig;
    const result = OnicodeConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing coordinator", () => {
    const { coordinator, ...rest } = validConfig;
    const result = OnicodeConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid defaultProvider", () => {
    const result = OnicodeConfigSchema.safeParse({
      ...validConfig,
      defaultProvider: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty defaultModel", () => {
    const result = OnicodeConfigSchema.safeParse({
      ...validConfig,
      defaultModel: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid nested permissions mode", () => {
    const result = OnicodeConfigSchema.safeParse({
      ...validConfig,
      permissions: { ...validConfig.permissions, mode: "invalid" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid nested coordinator value", () => {
    const result = OnicodeConfigSchema.safeParse({
      ...validConfig,
      coordinator: { maxConcurrentSubAgents: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid nested session dir", () => {
    const result = OnicodeConfigSchema.safeParse({
      ...validConfig,
      session: { dir: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid logLevel", () => {
    const result = OnicodeConfigSchema.safeParse({
      ...validConfig,
      logLevel: "verbose",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level fields (strict mode)", () => {
    const result = OnicodeConfigSchema.safeParse({
      ...validConfig,
      unknownField: "value",
    });
    expect(result.success).toBe(false);
  });
});

// ─── PartialOnicodeConfigSchema ──────────────────────────────────────────

describe("PartialOnicodeConfigSchema", () => {
  it("accepts empty object", () => {
    const result = PartialOnicodeConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it("accepts partial overrides for top-level fields", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      defaultProvider: "openai",
      defaultModel: "gpt-4o",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultProvider).toBe("openai");
      expect(result.data.defaultModel).toBe("gpt-4o");
    }
  });

  it("accepts partial permissions (only mode)", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      permissions: { mode: "plan" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial permissions (only allow)", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      permissions: { allow: ["Read(**)"] },
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial session (no dir)", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      session: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial coordinator (no maxConcurrentSubAgents)", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      coordinator: { perAgentTokenBudget: 50000 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts partial provider config", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      providers: {
        openai: {},
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts mcpServers config", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      mcpServers: {
        myServer: { command: "node", args: ["server.js"] },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts logLevel", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      logLevel: "warn",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid provider id", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      defaultProvider: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty defaultModel", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      defaultModel: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid nested permissions mode", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      permissions: { mode: "invalid" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid coordinator value", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      coordinator: { maxConcurrentSubAgents: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid logLevel", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      logLevel: "verbose",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown fields (strict mode)", () => {
    const result = PartialOnicodeConfigSchema.safeParse({
      unknownField: "value",
    });
    expect(result.success).toBe(false);
  });
});
