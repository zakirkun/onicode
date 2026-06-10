import { describe, it, expect } from "vitest";
import { checkPermission } from "../../../src/core/permissions/gate.js";
import type { PermissionContext, PermissionCheckInput } from "../../../src/core/permissions/types.js";

function ctx(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    mode: "default",
    allow: [],
    deny: [],
    ...overrides,
  };
}

function input(overrides: Partial<PermissionCheckInput> = {}): PermissionCheckInput {
  return {
    toolName: "Read",
    inputSummary: "/src/index.ts",
    destructive: false,
    ...overrides,
  };
}

describe("checkPermission", () => {
  describe("deny rules always win", () => {
    it("denies when a deny rule matches, even in bypassPermissions mode", () => {
      const decision = checkPermission(
        ctx({ mode: "bypassPermissions", deny: ["Write(/etc/**)"] }),
        input({ toolName: "Write", inputSummary: "/etc/passwd", destructive: true }),
      );
      expect(decision.kind).toBe("deny");
    });

    it("deny rule takes precedence over an allow rule", () => {
      const decision = checkPermission(
        ctx({ allow: ["Write(**)"], deny: ["Write(/etc/**)"] }),
        input({ toolName: "Write", inputSummary: "/etc/shadow", destructive: true }),
      );
      expect(decision.kind).toBe("deny");
    });

    it("wildcard deny rule blocks any tool", () => {
      const decision = checkPermission(
        ctx({ deny: ["*(re:.*secret.*)"] }),
        input({ toolName: "Read", inputSummary: "secret-keys.txt" }),
      );
      expect(decision.kind).toBe("deny");
    });

    it("deny beats mode auto-allow", () => {
      const decision = checkPermission(
        ctx({ mode: "acceptEdits", deny: ["Bash(rm -rf /**)"] }),
        input({ toolName: "Bash", inputSummary: "rm -rf /", destructive: true }),
      );
      expect(decision.kind).toBe("deny");
    });
  });

  describe("mode policy applied when no explicit rule", () => {
    it("default mode prompts for non-destructive calls", () => {
      const decision = checkPermission(ctx(), input());
      expect(decision.kind).toBe("prompt");
    });

    it("default mode prompts for destructive calls", () => {
      const decision = checkPermission(
        ctx(),
        input({ toolName: "Bash", inputSummary: "rm -rf build/", destructive: true }),
      );
      expect(decision.kind).toBe("prompt");
    });

    it("acceptEdits auto-allows non-destructive calls", () => {
      const decision = checkPermission(
        ctx({ mode: "acceptEdits" }),
        input({ toolName: "Read", inputSummary: "/src/foo.ts", destructive: false }),
      );
      expect(decision.kind).toBe("allow");
    });

    it("acceptEdits auto-allows destructive calls", () => {
      const decision = checkPermission(
        ctx({ mode: "acceptEdits" }),
        input({ toolName: "Write", inputSummary: "/src/foo.ts", destructive: true }),
      );
      expect(decision.kind).toBe("allow");
    });
  });

  describe("allow rules override mode prompts", () => {
    it("allow rule bypasses default mode prompt for non-destructive", () => {
      const decision = checkPermission(
        ctx({ allow: ["Read(**)"] }),
        input({ toolName: "Read", inputSummary: "/any/path.ts" }),
      );
      expect(decision.kind).toBe("allow");
    });

    it("allow rule bypasses default mode prompt for destructive", () => {
      const decision = checkPermission(
        ctx({ allow: ["Bash(re:^git\\s.*)"] }),
        input({ toolName: "Bash", inputSummary: "git status", destructive: true }),
      );
      expect(decision.kind).toBe("allow");
    });

    it("non-matching allow rule still prompts", () => {
      const decision = checkPermission(
        ctx({ allow: ["Read(**)"] }),
        input({ toolName: "Bash", inputSummary: "ls", destructive: true }),
      );
      expect(decision.kind).toBe("prompt");
    });
  });

  describe("prompt for unknown tools in interactive modes", () => {
    it("prompts for unknown non-destructive tool in default mode", () => {
      const decision = checkPermission(
        ctx(),
        input({ toolName: "CustomTool", inputSummary: "some input" }),
      );
      expect(decision.kind).toBe("prompt");
      if (decision.kind === "prompt") {
        expect(decision.preview).toBe("CustomTool: some input");
      }
    });

    it("prompts for unknown destructive tool in default mode", () => {
      const decision = checkPermission(
        ctx(),
        input({ toolName: "Deploy", inputSummary: "prod", destructive: true }),
      );
      expect(decision.kind).toBe("prompt");
    });
  });

  describe("plan mode blocks destructive, allows reads", () => {
    it("auto-allows non-destructive calls", () => {
      const decision = checkPermission(
        ctx({ mode: "plan" }),
        input({ toolName: "Read", inputSummary: "/src/index.ts", destructive: false }),
      );
      expect(decision.kind).toBe("allow");
    });

    it("auto-denies destructive calls", () => {
      const decision = checkPermission(
        ctx({ mode: "plan" }),
        input({ toolName: "Write", inputSummary: "/src/index.ts", destructive: true }),
      );
      expect(decision.kind).toBe("deny");
    });

    it("deny even when allow rule matches destructive (mode autoDeny wins before allow)", () => {
      // autoDenyDestructive is checked at step 2, before allow rules at step 3.
      const decision = checkPermission(
        ctx({ mode: "plan", allow: ["Write(**)"] }),
        input({ toolName: "Write", inputSummary: "/src/index.ts", destructive: true }),
      );
      expect(decision.kind).toBe("deny");
    });

    it("Bash is denied in plan mode", () => {
      const decision = checkPermission(
        ctx({ mode: "plan" }),
        input({ toolName: "Bash", inputSummary: "git status", destructive: true }),
      );
      expect(decision.kind).toBe("deny");
    });
  });

  describe("bypassPermissions allows everything", () => {
    it("auto-allows non-destructive calls", () => {
      const decision = checkPermission(
        ctx({ mode: "bypassPermissions" }),
        input({ toolName: "Read", inputSummary: "/etc/passwd" }),
      );
      expect(decision.kind).toBe("allow");
    });

    it("auto-allows destructive calls", () => {
      const decision = checkPermission(
        ctx({ mode: "bypassPermissions" }),
        input({ toolName: "Bash", inputSummary: "rm -rf /", destructive: true }),
      );
      expect(decision.kind).toBe("allow");
    });

    it("still respects deny rules", () => {
      const decision = checkPermission(
        ctx({ mode: "bypassPermissions", deny: ["Bash(rm -rf /**)"] }),
        input({ toolName: "Bash", inputSummary: "rm -rf /", destructive: true }),
      );
      expect(decision.kind).toBe("deny");
    });
  });
});
