/**
 * Result aggregator.
 *
 * Collects `AgentResult`s from sub-agent runs and formats them into a
 * single text payload suitable for the parent agent's context. The
 * parent's LLM sees sub-agent results as tool_result text; this module
 * controls the format.
 *
 * Format is intentionally terse: skill name, success/failure flag, final
 * text (or error), and usage summary. The parent agent does not need
 * the raw tool calls — those live in the session JSONL already.
 */
import type { AgentResult } from "./types.js";

/**
 * Format an `AgentResult` as the text payload returned via the
 * AgentSpawn tool_result.
 *
 * @param result - completed sub-agent outcome.
 */
export function formatAgentResult(result: AgentResult): string {
  const header = `[${result.skillName}] ${result.success ? "✓ success" : "✗ failed"} — tokens in:${result.usage.inputTokens} out:${result.usage.outputTokens}`;
  if (!result.success) {
    return `${header}\nError: ${result.error ?? "unknown"}`;
  }
  return `${header}\n\n${result.finalText}`;
}

/**
 * Aggregate multiple sub-agent results into a combined summary. Useful
 * when the parent spawns several sub-agents in parallel and wants a
 * unified view.
 *
 * @param results - array of completed sub-agent results.
 */
export function aggregateResults(results: readonly AgentResult[]): string {
  if (results.length === 0) {
    return "No sub-agents ran.";
  }
  return results.map(formatAgentResult).join("\n\n---\n\n");
}
