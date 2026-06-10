/**
 * Built-in `TaskSpawn` tool.
 *
 * Allows an agent to spawn a DAG of sub-tasks with explicit dependencies.
 * Unlike AgentSpawn (which runs a single sub-agent), TaskSpawn accepts a
 * graph of tasks and executes them respecting dependency order.
 *
 * Destructive: yes — spawning tasks may consume tokens and invoke tools.
 */
import { z } from "zod";

import { ToolValidationError } from "../../core/tools/errors.js";
import type { Tool, ToolExecCtx } from "../../core/tools/types.js";
import type { Coordinator } from "../../core/coordinator/coordinator.js";
import type { TaskNode } from "../../core/coordinator/taskGraphTypes.js";
import { formatAgentResult } from "../../core/coordinator/resultAggregator.js";

/** Input schema. */
const TaskSpawnInputSchema = z
  .object({
    /** List of tasks in the DAG. */
    tasks: z.array(
      z.object({
        /** Unique task identifier. */
        id: z.string().min(1),
        /** Skill name to resolve from the skill registry. */
        skillName: z.string().min(1),
        /** Task prompt given to the sub-agent. */
        task: z.string().min(1),
        /** Optional list of task IDs this task depends on. */
        dependsOn: z.array(z.string().min(1)).optional(),
        /** Optional model override. */
        modelOverride: z.string().min(1).optional(),
        /** Optional tool allow-list override. */
        toolAllowList: z.array(z.string().min(1)).optional(),
      }),
    ).min(1),
  })
  .strict();

/** Inferred input type. */
export type TaskSpawnInput = z.infer<typeof TaskSpawnInputSchema>;

/** Output shape returned to the LLM. */
export type TaskSpawnOutput = string;

/**
 * Create the `TaskSpawn` tool bound to a specific coordinator and parent agent id.
 *
 * @param coordinator - coordinator that executes the task graph.
 * @param parentId - id of the agent invoking this tool (used for tracking).
 * @returns a `Tool` that accepts a DAG definition and returns aggregated results.
 */
export function createTaskSpawnTool(
  coordinator: Coordinator,
  parentId: string,
): Tool<TaskSpawnInput, TaskSpawnOutput> {
  return {
    name: "TaskSpawn",
    description:
      "Spawn a DAG of sub-tasks with explicit dependencies. Tasks run in dependency order; failed tasks skip their dependents. Returns aggregated results and token usage.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["tasks"],
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          description: "List of tasks in the DAG. Each task has an id, skillName, task prompt, and optional dependsOn list.",
          items: {
            type: "object",
            required: ["id", "skillName", "task"],
            properties: {
              id: {
                type: "string",
                description: "Unique identifier for this task.",
              },
              skillName: {
                type: "string",
                description: "Skill name to resolve from the registry.",
              },
              task: {
                type: "string",
                description: "Task prompt for the sub-agent.",
              },
              dependsOn: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of task IDs this task depends on.",
              },
              modelOverride: {
                type: "string",
                description: "Optional model id override.",
              },
              toolAllowList: {
                type: "array",
                items: { type: "string" },
                description: "Optional tool allow-list override.",
              },
            },
          },
        },
      },
    },
    destructive: true,
    source: "builtin",

    summarize(input: TaskSpawnInput): string {
      return `TaskSpawn: ${input.tasks.length} task${input.tasks.length === 1 ? "" : "s"}`;
    },

    async execute(input: TaskSpawnInput, ctx: ToolExecCtx): Promise<TaskSpawnOutput> {
      const parsed = parseInput(input);

      const nodes: TaskNode[] = parsed.tasks.map((t) => ({
        id: t.id,
        skillName: t.skillName,
        task: t.task,
        ...(t.dependsOn !== undefined ? { dependsOn: t.dependsOn } : {}),
        ...(t.modelOverride !== undefined ? { modelOverride: t.modelOverride } : {}),
        ...(t.toolAllowList !== undefined ? { toolAllowList: t.toolAllowList } : {}),
      }));

      const result = await coordinator.executeGraph(
        { nodes },
        ctx.signal,
        parentId,
      );

      ctx.log.debug("task graph result", {
        taskCount: result.tasks.length,
        success: result.overallSuccess,
      });

      // Format results.
      const lines: string[] = [];
      lines.push(`Task graph completed (${result.tasks.length} tasks)`);
      lines.push(`Overall: ${result.overallSuccess ? "success" : "failure"}`);
      lines.push(`Token usage: ${result.totalUsage.inputTokens} in, ${result.totalUsage.outputTokens} out`);
      lines.push("");

      for (const taskState of result.tasks) {
        const node = nodes.find((n) => n.id === taskState.id)!;
        lines.push(`[${taskState.id}] ${node.skillName}: ${taskState.status}`);
        if (taskState.result) {
          lines.push(formatAgentResult(taskState.result));
        }
        if (taskState.error) {
          lines.push(`  Error: ${taskState.error}`);
        }
      }

      return lines.join("\n");
    },
  };
}

/** Validate input via zod and surface a `ToolValidationError` on failure. */
function parseInput(input: unknown): TaskSpawnInput {
  const result = TaskSpawnInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError("Invalid TaskSpawn input", result.error.issues);
  }
  return result.data;
}
