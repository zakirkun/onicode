/**
 * Coordinator types.
 *
 * The coordinator is the supervisor layer. It owns the top-level agent
 * and any sub-agents spawned via the `AgentSpawn` tool. Each sub-agent
 * runs as a fresh `Agent` with its own context window, system prompt
 * (compiled from a skill), and optionally restricted tool registry.
 *
 * Data flow:
 *   1. `SubAgentSpec` — describes what to spawn.
 *   2. Coordinator compiles the spec into an `Agent` + registry.
 *   3. Coordinator runs the sub-agent to completion.
 *   4. Result is aggregated and returned as a `ToolResult` payload.
 *
 * The coordinator is provider-agnostic. Provider construction is owned
 * by the CLI wiring layer (`commands/chat.ts` and `commands/run.ts`).
 */
import type { TokenUsage } from "../../providers/types.js";
import type { LLMProvider } from "../../providers/types.js";

/** Specification for spawning a sub-agent. */
export interface SubAgentSpec {
  /** Name of the skill to resolve from the registry. */
  skillName: string;
  /** Task prompt given to the sub-agent. */
  task: string;
  /** Optional tool allow-list override (takes precedence over skill's own). */
  toolAllowList?: readonly string[];
  /** Optional model override. */
  modelOverride?: string;
  /** Id of the parent agent that spawned this sub-agent. */
  parentId: string;
}

/**
 * Outcome of a sub-agent run. Returned to the spawning agent via a
 * tool_result event.
 */
export interface AgentResult {
  /** Sub-agent id. */
  agentId: string;
  /** Skill name that produced the agent. */
  skillName: string;
  /** Final assistant text from the sub-agent. */
  finalText: string;
  /** Aggregated token usage for the sub-agent run. */
  usage: TokenUsage;
  /** Whether the sub-agent completed successfully. */
  success: boolean;
  /** Error message when `success` is `false`. */
  error?: string;
}

/**
 * Lifecycle events emitted by the coordinator. The TUI subscribes to
 * render the agent panel; the session writer records them in JSONL.
 */
export type CoordinatorEvent =
  | { kind: "spawn"; agentId: string; skillName: string; parentId: string }
  | { kind: "complete"; agentId: string; skillName: string; usage: TokenUsage }
  | { kind: "error"; agentId: string; skillName: string; error: string };

/**
 * Provider resolver. The coordinator needs a provider to construct each
 * sub-agent; the wiring layer supplies a factory function rather than a
 * concrete provider so that per-skill provider overrides work.
 */
export type ProviderResolver = (providerId: string) => LLMProvider;

/**
 * Callback for coordinator lifecycle events. The session writer and TUI
 * implement this to record/display spawn and completion markers.
 */
export type CoordinatorEventHandler = (event: CoordinatorEvent) => void | Promise<void>;
