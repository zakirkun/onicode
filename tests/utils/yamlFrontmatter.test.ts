import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../src/utils/yamlFrontmatter.js";

describe("parseFrontmatter", () => {
  describe("valid frontmatter with --- delimiters", () => {
    it("parses simple key-value pairs and extracts body", () => {
      const source = `---
name: explorer
description: Read-only code search
---

This is the body.`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({
        name: "explorer",
        description: "Read-only code search",
      });
      expect(result.body).toBe("This is the body.");
    });

    it("parses nested YAML structures", () => {
      const source = `---
name: planner
metadata:
  version: 1
  tags:
    - planning
    - design
---

Plan goes here.`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({
        name: "planner",
        metadata: {
          version: 1,
          tags: ["planning", "design"],
        },
      });
      expect(result.body).toBe("Plan goes here.");
    });

    it("parses arrays in frontmatter", () => {
      const source = `---
allowedTools:
  - Read
  - Glob
  - Grep
---

Search instructions.`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({
        allowedTools: ["Read", "Glob", "Grep"],
      });
      expect(result.body).toBe("Search instructions.");
    });

    it("handles boolean and numeric values", () => {
      const source = `---
enabled: true
count: 42
ratio: 3.14
---

Content.`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({
        enabled: true,
        count: 42,
        ratio: 3.14,
      });
    });

    it("handles multiple body paragraphs", () => {
      const source = `---
name: test
---

First paragraph.

Second paragraph.

Third paragraph.`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({ name: "test" });
      expect(result.body).toContain("First paragraph.");
      expect(result.body).toContain("Second paragraph.");
      expect(result.body).toContain("Third paragraph.");
    });
  });

  describe("empty frontmatter", () => {
    it("handles empty YAML block between delimiters", () => {
      const source = `---
---

Body after empty frontmatter.`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({});
      expect(result.body).toBe("Body after empty frontmatter.");
    });

    it("handles frontmatter with only whitespace", () => {
      const source = `---

---

Body text.`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({});
      expect(result.body).toBe("Body text.");
    });

    it("handles empty frontmatter with no body", () => {
      const source = `---
---`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({});
      expect(result.body).toBe("");
    });
  });

  describe("no frontmatter (plain markdown)", () => {
    it("returns empty data and the full input as body", () => {
      const source = `# Heading

Some content here.`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({});
      expect(result.body).toBe("# Heading\n\nSome content here.");
    });

    it("handles a single line without delimiters", () => {
      const source = "Just a plain text line.";
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({});
      expect(result.body).toBe("Just a plain text line.");
    });

    it("handles completely empty input", () => {
      const result = parseFrontmatter("");
      expect(result.data).toEqual({});
      expect(result.body).toBe("");
    });

    it("treats --- not at start as regular content", () => {
      const source = `Some text first.

---

More text.`;
      const result = parseFrontmatter(source);
      // gray-matter requires --- at the very start; otherwise it's plain content
      expect(result.data).toEqual({});
      expect(result.body).toContain("Some text first.");
    });
  });

  describe("malformed YAML handling", () => {
    it("throws on severely malformed YAML in frontmatter block", () => {
      const source = `---
name: [invalid
  broken yaml here
---

Body.`;
      // gray-matter delegates to js-yaml which throws YAMLException on
      // unparseable frontmatter (e.g. unclosed flow collections).
      expect(() => parseFrontmatter(source)).toThrow();
    });

    it("handles YAML with tab characters (invalid YAML indentation)", () => {
      const source = `---
name: test
\tdescription: tabbed
---

Content.`;
      // Should not throw; gray-matter handles this gracefully
      const result = parseFrontmatter(source);
      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("body");
    });
  });

  describe("body extraction", () => {
    it("trims leading whitespace from body after frontmatter", () => {
      const source = `---
name: test
---


Body with leading blank lines.`;
      const result = parseFrontmatter(source);
      expect(result.body).toBe("Body with leading blank lines.");
    });

    it("preserves body content with markdown formatting", () => {
      const source = `---
name: implementer
---

## Instructions

1. Read the file
2. Make changes
3. Run \`pnpm test\`

> Important note`;
      const result = parseFrontmatter(source);
      expect(result.body).toBe(`## Instructions

1. Read the file
2. Make changes
3. Run \`pnpm test\`

> Important note`);
    });

    it("handles body with code blocks", () => {
      const source = `---
name: helper
---

Example:

\`\`\`typescript
const x = 42;
\`\`\`

End.`;
      const result = parseFrontmatter(source);
      expect(result.body).toContain("```typescript");
      expect(result.body).toContain("const x = 42;");
      expect(result.body).toContain("```");
    });

    it("returns empty body when only frontmatter is present", () => {
      const source = `---
name: empty-body
description: no body
---`;
      const result = parseFrontmatter(source);
      expect(result.data).toEqual({
        name: "empty-body",
        description: "no body",
      });
      expect(result.body).toBe("");
    });

    it("handles frontmatter with YAML null values (tilde)", () => {
      const source = `---
name: test
model: ~
temperature: ~
---

Body.`;
      const result = parseFrontmatter(source);
      expect(result.data.name).toBe("test");
      // YAML ~ is null, which maps to null in JS
      expect(result.data.model).toBeNull();
      expect(result.data.temperature).toBeNull();
      expect(result.body).toBe("Body.");
    });
  });
});
