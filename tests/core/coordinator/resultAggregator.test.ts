import { describe, it, expect } from "vitest";
import {
  formatAgentResult,
  aggregateResults,
} from "../../../src/core/coordinator/resultAggregator.js";
import type { AgentResult } from "../../../src/core/coordinator/types.js";

/** Helper to build an `AgentResult` with sensible defaults. */
function result(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agentId: "agent-1",
    skillName: "explorer",
    finalText: "Found 3 files.",
    usage: { inputTokens: 100, outputTokens: 50 },
    success: true,
    ...overrides,
  };
}

describe("formatAgentResult", () => {
  it("formats a successful result with header and final text", () => {
    const text = formatAgentResult(result());
    expect(text).toContain("[explorer]");
    expect(text).toContain("✓ success");
    expect(text).toContain("in:100");
    expect(text).toContain("out:50");
    expect(text).toContain("Found 3 files.");
  });

  it("formats a failed result with error message", () => {
    const text = formatAgentResult(
      result({ success: false, finalText: "", error: "rate limited" }),
    );
    expect(text).toContain("[explorer]");
    expect(text).toContain("✗ failed");
    expect(text).toContain("Error: rate limited");
    // Should NOT contain finalText for failures
    expect(text).not.toContain("Found 3 files.");
  });

  it("falls back to 'unknown' when error is missing on failure", () => {
    const text = formatAgentResult(result({ success: false, finalText: "" }));
    expect(text).toContain("Error: unknown");
  });

  it("includes token usage in the header", () => {
    const text = formatAgentResult(
      result({ usage: { inputTokens: 500, outputTokens: 250 } }),
    );
    expect(text).toContain("in:500");
    expect(text).toContain("out:250");
  });

  it("uses the skill name from the result", () => {
    const text = formatAgentResult(result({ skillName: "implementer" }));
    expect(text).toContain("[implementer]");
  });
});

describe("aggregateResults", () => {
  it("returns a placeholder when no results are provided", () => {
    expect(aggregateResults([])).toBe("No sub-agents ran.");
  });

  it("formats a single result without separators", () => {
    const text = aggregateResults([result()]);
    expect(text).toContain("[explorer]");
    expect(text).toContain("Found 3 files.");
    // No separator for a single entry
    expect(text).not.toContain("---");
  });

  it("joins multiple results with a horizontal rule separator", () => {
    const text = aggregateResults([
      result({ skillName: "explorer", finalText: "Found files." }),
      result({ skillName: "planner", finalText: "Plan ready." }),
    ]);
    expect(text).toContain("[explorer]");
    expect(text).toContain("[planner]");
    expect(text).toContain("Found files.");
    expect(text).toContain("Plan ready.");
    expect(text).toContain("---");
  });

  it("handles a mix of successful and failed results", () => {
    const text = aggregateResults([
      result({ skillName: "explorer", finalText: "Done." }),
      result({
        skillName: "implementer",
        success: false,
        finalText: "",
        error: "compilation failed",
      }),
    ]);
    expect(text).toContain("✓ success");
    expect(text).toContain("✗ failed");
    expect(text).toContain("Error: compilation failed");
    expect(text).toContain("Done.");
  });

  it("aggregates three or more results", () => {
    const results = [
      result({ skillName: "explorer" }),
      result({ skillName: "planner" }),
      result({ skillName: "implementer" }),
    ];
    const text = aggregateResults(results);
    expect(text).toContain("[explorer]");
    expect(text).toContain("[planner]");
    expect(text).toContain("[implementer]");
    // Two separators for three entries
    const separatorCount = text.split("---").length - 1;
    expect(separatorCount).toBe(2);
  });

  it("handles failed results with missing error gracefully", () => {
    const text = aggregateResults([
      result({ success: false, finalText: "" }),
    ]);
    expect(text).toContain("✗ failed");
    expect(text).toContain("Error: unknown");
  });

  it("preserves individual token usage per result", () => {
    const text = aggregateResults([
      result({ skillName: "a", usage: { inputTokens: 10, outputTokens: 20 } }),
      result({ skillName: "b", usage: { inputTokens: 30, outputTokens: 40 } }),
    ]);
    expect(text).toContain("in:10");
    expect(text).toContain("out:20");
    expect(text).toContain("in:30");
    expect(text).toContain("out:40");
  });
});
