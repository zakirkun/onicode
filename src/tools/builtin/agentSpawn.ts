/**
 * Built-in `AgentSpawn` tool.
 *
 * Allows the top-level agent (or any agent with access to this tool) to
 * delegate work to a sub-agent by specifying a skill name and task prompt.
 *
 * The tool is a thin bridge between the agent loop and the coordinator:
 *   1. Validate the input (skill name + task).
 *   2. Call `coordinator.spawn(spec, signal)`.
 *   3. Return the sub-agent's formatted result.
 *
 * The coordinator owns skill resolution, concurrency control, and agent
 * construction. This tool only translates the LLM's intent into a call.
 *
 * Destructive: yes — spawning a sub-agent may consume tokens and invoke
 * tools on behalf of the parent.
 */
import { z } from "zod";

import { ToolValidationError } from "../../core/tools/errors.js";
import type { Tool, ToolExecCtx } from "../../core/tools/types.js";
import type { Coordinator } from "../../core/coordinator/coordinator.js";
import { formatAgentResult } from "../../core/coordinator/resultAggregator.js";

/** Input schema. */
const AgentSpawnInputSchema = z
  .object({
    /** Skill name to resolve from the skill registry. */
    skillName: z.string().min(1),
    /** Task prompt given to the sub-agent. */
    task: z.string().min(1),
    /** Optional tool allow-list override. */
    toolAllowList: z.array(z.string().min(1)).optional(),
    /** Optional model override (e.g. "claude-3-haiku-20240307"). */
    modelOverride: z.string().min(1).optional(),
  })
  .strict();

/** Inferred input type. */
export type AgentSpawnInput = z.infer<typeof AgentSpawnInputSchema>;

/** Output shape returned to the LLM. */
export type AgentSpawnOutput = string;

/**
 * Create the `AgentSpawn` tool bound to a specific coordinator and parent
 * agent id. The tool is constructed per-agent so that `parentId` is always
 * correct for sub-agent tracking.
 *
 * @param coordinator - coordinator that will spawn the sub-agent.
 * @param parentId - id of the agent that owns this tool instance.
 */
export function createAgentSpawnTool(
  coordinator: Coordinator,
  parentId: string,
): Tool<AgentSpawnInput, AgentSpawnOutput> {
  return {
    name: "AgentSpawn",
    description:
      "Spawn a sub-agent to handle a delegated task. The sub-agent runs with its own context window, system prompt (compiled from the named skill), and optionally restricted tool set. Returns the sub-agent's final text response and token usage summary.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["skillName", "task"],
      properties: {
        skillName: {
          type: "string",
          description:
            "Name of the skill to resolve. Must be registered in the skill registry.",
        },
        task: {
          type: "string",
          description: "Task prompt given to the sub-agent. Be specific and include context.",
        },
        toolAllowList: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of tool names the sub-agent may use. Overrides the skill's own allow-list.",
        },
        modelOverride: {
          type: "string",
          description:
            "Optional model id override (e.g. 'claude-3-haiku-20240307'). Falls back to skill's model, then default.",
        },
      },
    },
    destructive: true,
    source: "builtin",

    summarize(input: AgentSpawnInput): string {
      return `Spawn ${input.skillName}: ${truncate(input.task, 80)}`;
    },

    async execute(input: AgentSpawnInput, ctx: ToolExecCtx): Promise<AgentSpawnOutput> {
      const parsed = parseInput(input);

      const result = await coordinator.spawn(
        {
          skillName: parsed.skillName,
          task: parsed.task,
          parentId,
          ...(parsed.toolAllowList !== undefined
            ? { toolAllowList: parsed.toolAllowList }
            : {}),
          ...(parsed.modelOverride !== undefined
            ? { modelOverride: parsed.modelOverride }
            : {}),
        },
        ctx.signal,
      );

      ctx.log.debug("sub-agent result", {
        skillName: result.skillName,
        success: result.success,
        agentId: result.agentId,
      });

      return formatAgentResult(result);
    },
  };
}

/** Validate input via zod and surface a `ToolValidationError` on failure. */
function parseInput(input: unknown): AgentSpawnInput {
  const result = AgentSpawnInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError("Invalid AgentSpawn input", result.error.issues);
  }
  return result.data;
}

/** Truncate text to a maximum length, appending ellipsis if needed. */
function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}
