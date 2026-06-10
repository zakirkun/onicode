import { describe, it, expect } from "vitest";
import { compileSkill } from "../../../src/core/skills/compiler.js";
import type { Skill } from "../../../src/core/skills/types.js";
import { ToolRegistry } from "../../../src/core/tools/registry.js";
import type { Tool } from "../../../src/core/tools/types.js";

/** Build a minimal stub tool for registry population. */
function stubTool(name: string): Tool {
  return {
    name,
    description: `Stub tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    destructive: false,
    source: "builtin",
    summarize: () => name,
    execute: async () => undefined,
  };
}

/** Build a parent registry pre-loaded with the given tool names. */
function buildRegistry(...names: string[]): ToolRegistry {
  const reg = new ToolRegistry();
  for (const n of names) reg.register(stubTool(n));
  return reg;
}

/** Minimal valid skill — callers spread overrides on top. */
function baseSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "explorer",
    description: "Read-only exploration skill.",
    body: "You are an explorer. Read files and report findings.",
    source: { path: "/skills/explorer.skill.md", scope: "builtin" },
    ...overrides,
  };
}

describe("compileSkill", () => {
  const parentRegistry = buildRegistry("Read", "Write", "Edit", "Bash", "Glob", "Grep");

  // ---------------------------------------------------------------
  // Basic compilation
  // ---------------------------------------------------------------
  describe("basic compilation with all fields", () => {
    it("produces config with agent id, model, provider, and system prompt", () => {
      const skill = baseSkill();
      const result = compileSkill({
        skill,
        agentId: "agent-42",
        defaultModel: "claude-sonnet-4-20250514",
        defaultProviderId: "anthropic",
        parentRegistry,
      });

      expect(result.config.id).toBe("agent-42");
      expect(result.config.model).toBe("claude-sonnet-4-20250514");
      expect(result.config.providerId).toBe("anthropic");
      expect(result.config.systemPrompt).toBe(skill.body);
    });

    it("includes temperature and maxOutputTokens when skill specifies them", () => {
      const skill = baseSkill({ temperature: 0.3, maxOutputTokens: 4096 });
      const result = compileSkill({
        skill,
        agentId: "agent-1",
        defaultModel: "claude-sonnet-4-20250514",
        defaultProviderId: "anthropic",
        parentRegistry,
      });

      expect(result.config.temperature).toBe(0.3);
      expect(result.config.maxOutputTokens).toBe(4096);
    });

    it("returns both config and registry", () => {
      const result = compileSkill({
        skill: baseSkill(),
        agentId: "a-0",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result).toHaveProperty("config");
      expect(result).toHaveProperty("registry");
    });
  });

  // ---------------------------------------------------------------
  // allowedTools filters parent registry
  // ---------------------------------------------------------------
  describe("allowedTools filtering", () => {
    it("returns a filtered registry containing only the listed tools", () => {
      const skill = baseSkill({ allowedTools: ["Read", "Glob"] });
      const result = compileSkill({
        skill,
        agentId: "a-1",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result.registry.size()).toBe(2);
      expect(result.registry.has("Read")).toBe(true);
      expect(result.registry.has("Glob")).toBe(true);
      expect(result.registry.has("Write")).toBe(false);
      expect(result.registry.has("Edit")).toBe(false);
      expect(result.registry.has("Bash")).toBe(false);
      expect(result.registry.has("Grep")).toBe(false);
    });

    it("silently ignores unknown tool names in allowedTools", () => {
      const skill = baseSkill({ allowedTools: ["Read", "NonExistent", "AlsoMissing"] });
      const result = compileSkill({
        skill,
        agentId: "a-2",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result.registry.size()).toBe(1);
      expect(result.registry.has("Read")).toBe(true);
    });

    it("does not mutate the parent registry", () => {
      const sizeBefore = parentRegistry.size();
      const skill = baseSkill({ allowedTools: ["Read"] });
      compileSkill({
        skill,
        agentId: "a-3",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(parentRegistry.size()).toBe(sizeBefore);
    });
  });

  // ---------------------------------------------------------------
  // Empty / undefined allowedTools inherits all
  // ---------------------------------------------------------------
  describe("empty or undefined allowedTools", () => {
    it("inherits the full parent registry when allowedTools is undefined", () => {
      const skill = baseSkill({ allowedTools: undefined });
      const result = compileSkill({
        skill,
        agentId: "a-4",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      // Should be the exact same reference — no filtering
      expect(result.registry).toBe(parentRegistry);
    });

    it("inherits the full parent registry when allowedTools is empty array", () => {
      const skill = baseSkill({ allowedTools: [] });
      const result = compileSkill({
        skill,
        agentId: "a-5",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result.registry).toBe(parentRegistry);
    });
  });

  // ---------------------------------------------------------------
  // Model override chain: spec > skill > default
  // ---------------------------------------------------------------
  describe("model override chain", () => {
    it("uses defaultModel when skill has no model override", () => {
      const skill = baseSkill({ model: undefined });
      const result = compileSkill({
        skill,
        agentId: "a-6",
        defaultModel: "claude-sonnet-4-20250514",
        defaultProviderId: "anthropic",
        parentRegistry,
      });

      expect(result.config.model).toBe("claude-sonnet-4-20250514");
    });

    it("uses skill model when set, overriding the default", () => {
      const skill = baseSkill({ model: "gpt-4o" });
      const result = compileSkill({
        skill,
        agentId: "a-7",
        defaultModel: "claude-sonnet-4-20250514",
        defaultProviderId: "anthropic",
        parentRegistry,
      });

      expect(result.config.model).toBe("gpt-4o");
    });

    it("uses skill provider when set, overriding the default", () => {
      const skill = baseSkill({ provider: "openai" });
      const result = compileSkill({
        skill,
        agentId: "a-8",
        defaultModel: "claude-sonnet-4-20250514",
        defaultProviderId: "anthropic",
        parentRegistry,
      });

      expect(result.config.providerId).toBe("openai");
    });

    it("falls back to defaultProviderId when skill has no provider override", () => {
      const skill = baseSkill({ provider: undefined });
      const result = compileSkill({
        skill,
        agentId: "a-9",
        defaultModel: "claude-sonnet-4-20250514",
        defaultProviderId: "anthropic",
        parentRegistry,
      });

      expect(result.config.providerId).toBe("anthropic");
    });
  });

  // ---------------------------------------------------------------
  // Undefined optional fields fall through (omitted from config)
  // ---------------------------------------------------------------
  describe("undefined optional fields fall through", () => {
    it("omits temperature from config when skill does not set it", () => {
      const skill = baseSkill({ temperature: undefined });
      const result = compileSkill({
        skill,
        agentId: "a-10",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result.config.temperature).toBeUndefined();
      expect("temperature" in result.config).toBe(false);
    });

    it("omits maxOutputTokens from config when skill does not set it", () => {
      const skill = baseSkill({ maxOutputTokens: undefined });
      const result = compileSkill({
        skill,
        agentId: "a-11",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result.config.maxOutputTokens).toBeUndefined();
      expect("maxOutputTokens" in result.config).toBe(false);
    });

    it("includes temperature when skill sets it to 0", () => {
      const skill = baseSkill({ temperature: 0 });
      const result = compileSkill({
        skill,
        agentId: "a-12",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result.config.temperature).toBe(0);
    });
  });

  // ---------------------------------------------------------------
  // System prompt from skill body
  // ---------------------------------------------------------------
  describe("system prompt from skill body", () => {
    it("passes skill body verbatim as system prompt", () => {
      const body = "You are a code reviewer. Be thorough and constructive.";
      const skill = baseSkill({ body });
      const result = compileSkill({
        skill,
        agentId: "a-13",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result.config.systemPrompt).toBe(body);
    });

    it("handles multi-line skill body", () => {
      const body = [
        "You are an implementer.",
        "",
        "Rules:",
        "- Always run tests after changes.",
        "- Keep commits atomic.",
      ].join("\n");
      const skill = baseSkill({ body });
      const result = compileSkill({
        skill,
        agentId: "a-14",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result.config.systemPrompt).toBe(body);
    });

    it("handles empty body string", () => {
      const skill = baseSkill({ body: "" });
      const result = compileSkill({
        skill,
        agentId: "a-15",
        defaultModel: "m",
        defaultProviderId: "p",
        parentRegistry,
      });

      expect(result.config.systemPrompt).toBe("");
    });
  });

  // ---------------------------------------------------------------
  // Combined overrides
  // ---------------------------------------------------------------
  describe("combined overrides", () => {
    it("applies skill model, provider, temperature, maxOutputTokens, and allowedTools together", () => {
      const skill = baseSkill({
        model: "gpt-4o-mini",
        provider: "openai",
        temperature: 0.7,
        maxOutputTokens: 2048,
        allowedTools: ["Read", "Glob", "Grep"],
      });
      const result = compileSkill({
        skill,
        agentId: "agent-full",
        defaultModel: "claude-sonnet-4-20250514",
        defaultProviderId: "anthropic",
        parentRegistry,
      });

      expect(result.config.id).toBe("agent-full");
      expect(result.config.model).toBe("gpt-4o-mini");
      expect(result.config.providerId).toBe("openai");
      expect(result.config.temperature).toBe(0.7);
      expect(result.config.maxOutputTokens).toBe(2048);
      expect(result.config.systemPrompt).toBe(skill.body);
      expect(result.registry.size()).toBe(3);
      expect(result.registry.has("Read")).toBe(true);
      expect(result.registry.has("Glob")).toBe(true);
      expect(result.registry.has("Grep")).toBe(true);
    });
  });
});
