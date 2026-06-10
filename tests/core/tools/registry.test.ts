import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/core/tools/registry.js";
import type { Tool } from "../../../src/core/tools/types.js";

/**
 * Helper to create a mock tool with the given name and optional overrides.
 */
function createMockTool(
  name: string,
  overrides: Partial<Tool> = {}
): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    inputSchema: { type: "object", properties: {} },
    destructive: false,
    source: "builtin",
    summarize: vi.fn(() => `summary for ${name}`),
    execute: vi.fn(async () => ({ result: name })),
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  describe("register and retrieve", () => {
    it("registers a tool and retrieves it by name", () => {
      const registry = new ToolRegistry();
      const tool = createMockTool("Read");

      registry.register(tool);

      expect(registry.get("Read")).toBe(tool);
    });

    it("registers multiple tools", () => {
      const registry = new ToolRegistry();
      const read = createMockTool("Read");
      const write = createMockTool("Write");
      const bash = createMockTool("Bash");

      registry.register(read);
      registry.register(write);
      registry.register(bash);

      expect(registry.get("Read")).toBe(read);
      expect(registry.get("Write")).toBe(write);
      expect(registry.get("Bash")).toBe(bash);
    });

    it("preserves insertion order in list()", () => {
      const registry = new ToolRegistry();
      const tools = ["A", "B", "C", "D"].map((n) => createMockTool(n));

      for (const tool of tools) {
        registry.register(tool);
      }

      const listed = registry.list();
      expect(listed.map((t) => t.name)).toEqual(["A", "B", "C", "D"]);
    });
  });

  describe("duplicate registration", () => {
    it("throws when registering a tool with a duplicate name", () => {
      const registry = new ToolRegistry();
      const tool1 = createMockTool("Read");
      const tool2 = createMockTool("Read", { description: "Different" });

      registry.register(tool1);

      expect(() => registry.register(tool2)).toThrow(
        "Tool already registered: Read"
      );
    });

    it("does not overwrite the original tool on duplicate", () => {
      const registry = new ToolRegistry();
      const tool1 = createMockTool("Read");
      const tool2 = createMockTool("Read", { description: "Different" });

      registry.register(tool1);
      try {
        registry.register(tool2);
      } catch {
        // expected
      }

      expect(registry.get("Read")).toBe(tool1);
      expect(registry.get("Read")?.description).toBe("Mock tool: Read");
    });
  });

  describe("lookup by name", () => {
    it("returns the tool when found", () => {
      const registry = new ToolRegistry();
      const tool = createMockTool("Grep");
      registry.register(tool);

      expect(registry.get("Grep")).toBe(tool);
    });

    it("returns undefined when not found", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("Read"));

      expect(registry.get("NonExistent")).toBeUndefined();
    });

    it("has() returns true for registered tool", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("Read"));

      expect(registry.has("Read")).toBe(true);
    });

    it("has() returns false for unregistered tool", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("Read"));

      expect(registry.has("Write")).toBe(false);
    });
  });

  describe("size", () => {
    it("returns 0 for empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.size()).toBe(0);
    });

    it("returns correct count after registrations", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("A"));
      registry.register(createMockTool("B"));
      registry.register(createMockTool("C"));

      expect(registry.size()).toBe(3);
    });
  });

  describe("list", () => {
    it("returns empty array for empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.list()).toEqual([]);
    });

    it("returns all registered tools", () => {
      const registry = new ToolRegistry();
      const a = createMockTool("A");
      const b = createMockTool("B");
      registry.register(a);
      registry.register(b);

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list).toContain(a);
      expect(list).toContain(b);
    });
  });

  describe("manifests", () => {
    it("returns empty array for empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.manifests()).toEqual([]);
    });

    it("returns manifests for all registered tools", () => {
      const registry = new ToolRegistry();
      registry.register(
        createMockTool("Read", {
          description: "Read a file",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
          source: "builtin",
        })
      );
      registry.register(
        createMockTool("McpTool", {
          description: "An MCP tool",
          inputSchema: { type: "object", properties: { arg: { type: "number" } } },
          source: "mcp",
        })
      );

      const manifests = registry.manifests();
      expect(manifests).toHaveLength(2);
      expect(manifests[0]).toEqual({
        name: "Read",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        source: "builtin",
      });
      expect(manifests[1]).toEqual({
        name: "McpTool",
        description: "An MCP tool",
        inputSchema: { type: "object", properties: { arg: { type: "number" } } },
        source: "mcp",
      });
    });

    it("does not include destructive, summarize, or execute in manifests", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("Test"));

      const manifest = registry.manifests()[0];
      expect(manifest).not.toHaveProperty("destructive");
      expect(manifest).not.toHaveProperty("summarize");
      expect(manifest).not.toHaveProperty("execute");
    });
  });

  describe("filter", () => {
    it("returns a new registry with only allowed tools", () => {
      const registry = new ToolRegistry();
      const read = createMockTool("Read");
      const write = createMockTool("Write");
      const bash = createMockTool("Bash");
      registry.register(read);
      registry.register(write);
      registry.register(bash);

      const filtered = registry.filter(["Read", "Bash"]);

      expect(filtered.size()).toBe(2);
      expect(filtered.has("Read")).toBe(true);
      expect(filtered.has("Bash")).toBe(true);
      expect(filtered.has("Write")).toBe(false);
    });

    it("silently ignores names in allowList that do not exist", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("Read"));

      const filtered = registry.filter(["Read", "NonExistent", "AlsoMissing"]);

      expect(filtered.size()).toBe(1);
      expect(filtered.has("Read")).toBe(true);
    });

    it("returns empty registry when allowList is empty", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("Read"));
      registry.register(createMockTool("Write"));

      const filtered = registry.filter([]);

      expect(filtered.size()).toBe(0);
    });

    it("returns empty registry when no tools match allowList", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("Read"));

      const filtered = registry.filter(["NonExistent"]);

      expect(filtered.size()).toBe(0);
    });

    it("filtered registry shares no state with parent", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("Read"));

      const filtered = registry.filter(["Read"]);

      // Adding to filtered should not affect parent
      filtered.register(createMockTool("NewTool"));
      expect(filtered.has("NewTool")).toBe(true);
      expect(registry.has("NewTool")).toBe(false);

      // Adding to parent should not affect filtered
      registry.register(createMockTool("AnotherTool"));
      expect(registry.has("AnotherTool")).toBe(true);
      expect(filtered.has("AnotherTool")).toBe(false);
    });

    it("preserves tool identity in filtered registry", () => {
      const registry = new ToolRegistry();
      const tool = createMockTool("Read");
      registry.register(tool);

      const filtered = registry.filter(["Read"]);

      expect(filtered.get("Read")).toBe(tool);
    });

    it("preserves order according to allowList", () => {
      const registry = new ToolRegistry();
      registry.register(createMockTool("A"));
      registry.register(createMockTool("B"));
      registry.register(createMockTool("C"));

      const filtered = registry.filter(["C", "A"]);

      const names = filtered.list().map((t) => t.name);
      expect(names).toEqual(["C", "A"]);
    });
  });

  describe("empty registry edge cases", () => {
    it("get returns undefined on empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.get("Anything")).toBeUndefined();
    });

    it("has returns false on empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.has("Anything")).toBe(false);
    });

    it("size returns 0 on empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.size()).toBe(0);
    });

    it("list returns empty array on empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.list()).toEqual([]);
    });

    it("manifests returns empty array on empty registry", () => {
      const registry = new ToolRegistry();
      expect(registry.manifests()).toEqual([]);
    });

    it("filter on empty registry returns empty registry", () => {
      const registry = new ToolRegistry();
      const filtered = registry.filter(["Read", "Write"]);

      expect(filtered.size()).toBe(0);
    });
  });
});
