import { describe, it, expect } from "vitest";
import { SkillFrontmatterSchema } from "../../../src/core/skills/schema.js";

describe("SkillFrontmatterSchema", () => {
  describe("valid skill frontmatter", () => {
    it("parses minimal valid frontmatter", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "explorer",
        description: "Read-only exploration skill",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("explorer");
        expect(result.data.description).toBe("Read-only exploration skill");
      }
    });

    it("parses complete valid frontmatter with all fields", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "planner",
        description: "Plans implementation strategy",
        model: "claude-3-opus",
        provider: "anthropic",
        temperature: 0.7,
        maxOutputTokens: 4096,
        allowedTools: ["Read", "Glob", "Grep"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("planner");
        expect(result.data.description).toBe("Plans implementation strategy");
        expect(result.data.model).toBe("claude-3-opus");
        expect(result.data.provider).toBe("anthropic");
        expect(result.data.temperature).toBe(0.7);
        expect(result.data.maxOutputTokens).toBe(4096);
        expect(result.data.allowedTools).toEqual(["Read", "Glob", "Grep"]);
      }
    });

    it("accepts name with dashes and underscores", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "my-skill_name",
        description: "Test",
      });
      expect(result.success).toBe(true);
    });

    it("accepts name with digits", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "skill123",
        description: "Test",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("allowedTools normalization", () => {
    it("accepts allowedTools as array of strings", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        allowedTools: ["Read", "Write", "Bash"],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowedTools).toEqual(["Read", "Write", "Bash"]);
      }
    });

    it("accepts allowedTools as single string", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        allowedTools: "Read",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowedTools).toBe("Read");
      }
    });

    it("accepts allowedTools as comma-separated string", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        allowedTools: "Read,Write,Bash",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowedTools).toBe("Read,Write,Bash");
      }
    });

    it("transforms YAML null (~) to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        allowedTools: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowedTools).toBeUndefined();
      }
    });

    it("transforms undefined to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        allowedTools: undefined,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowedTools).toBeUndefined();
      }
    });

    it("rejects empty array", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        allowedTools: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.allowedTools).toEqual([]);
      }
    });

    it("rejects array with empty strings", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        allowedTools: ["Read", ""],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty string", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        allowedTools: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("optional fields", () => {
    it("transforms missing model to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.model).toBeUndefined();
      }
    });

    it("transforms null model to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        model: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.model).toBeUndefined();
      }
    });

    it("transforms missing provider to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBeUndefined();
      }
    });

    it("transforms null provider to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        provider: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.provider).toBeUndefined();
      }
    });

    it("transforms missing temperature to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.temperature).toBeUndefined();
      }
    });

    it("transforms null temperature to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        temperature: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.temperature).toBeUndefined();
      }
    });

    it("transforms missing maxOutputTokens to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxOutputTokens).toBeUndefined();
      }
    });

    it("transforms null maxOutputTokens to undefined", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        maxOutputTokens: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxOutputTokens).toBeUndefined();
      }
    });

    it("accepts valid provider values", () => {
      for (const provider of ["anthropic", "openai", "ollama"]) {
        const result = SkillFrontmatterSchema.safeParse({
          name: "test",
          description: "Test",
          provider,
        });
        expect(result.success).toBe(true);
      }
    });

    it("accepts temperature at boundaries", () => {
      const result0 = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        temperature: 0,
      });
      expect(result0.success).toBe(true);

      const result2 = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        temperature: 2,
      });
      expect(result2.success).toBe(true);
    });

    it("accepts valid maxOutputTokens", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        maxOutputTokens: 1024,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("invalid name", () => {
    it("rejects empty name", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "",
        description: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name with spaces", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "my skill",
        description: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name with special characters", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "skill@name",
        description: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name with dots", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "skill.name",
        description: "Test",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("missing required fields", () => {
    it("rejects missing name", () => {
      const result = SkillFrontmatterSchema.safeParse({
        description: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing description", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty description", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects completely empty object", () => {
      const result = SkillFrontmatterSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe("invalid field values", () => {
    it("rejects invalid provider", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        provider: "invalid-provider",
      });
      expect(result.success).toBe(false);
    });

    it("rejects temperature below 0", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        temperature: -0.1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects temperature above 2", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        temperature: 2.1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-positive maxOutputTokens", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        maxOutputTokens: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative maxOutputTokens", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        maxOutputTokens: -100,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer maxOutputTokens", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        maxOutputTokens: 1024.5,
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty model string", () => {
      const result = SkillFrontmatterSchema.safeParse({
        name: "test",
        description: "Test",
        model: "",
      });
      expect(result.success).toBe(false);
    });
  });
});
