/**
 * Built-in `TaskQuery` tool.
 *
 * Queries the result of a previously spawned task (from TaskSpawn or
 * Background agents). Returns the task's current status, final text,
 * and token usage.
 *
 * Non-destructive: read-only query.
 */
import { z } from "zod";

import { ToolValidationError } from "../../core/tools/errors.js";
import type { Tool } from "../../core/tools/types.js";
import { formatAgentResult } from "../../core/coordinator/resultAggregator.js";
import type { TaskQueryResult } from "./taskResultStore.js";
import type { TaskResultStore } from "./taskResultStore.js";

/** Input schema. */
const TaskQueryInputSchema = z
  .object({
    taskId: z.string().min(1),
  })
  .strict();

/** Inferred input type. */
export type TaskQueryInput = z.infer<typeof TaskQueryInputSchema>;

/** Output shape returned to the LLM. */
export type TaskQueryOutput = string;

/**
 * Create the `TaskQuery` tool bound to a shared result store.
 *
 * @param resultStore - store holding results from previously spawned tasks.
 * @returns a read-only `Tool` that retrieves task status, output, and usage.
 */
export function createTaskQueryTool(
  resultStore: TaskResultStore,
): Tool<TaskQueryInput, TaskQueryOutput> {
  return {
    name: "TaskQuery",
    description:
      "Query the result of a previously spawned task (from TaskSpawn or Background agents). Returns status, final text, and token usage.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId"],
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to query.",
        },
      },
    },
    destructive: false,
    source: "builtin",

    summarize(input: TaskQueryInput): string {
      return `TaskQuery: ${input.taskId}`;
    },

    async execute(input: TaskQueryInput): Promise<TaskQueryOutput> {
      const parsed = parseInput(input);

      const result: TaskQueryResult | undefined = resultStore.get(parsed.taskId);
      if (!result) {
        return `Task "${parsed.taskId}" not found. It may not have been spawned yet or was from a previous session.`;
      }

      const lines: string[] = [];
      lines.push(`Task ID: ${result.taskId}`);
      lines.push(`Status: ${result.status}`);
      if (result.skillName) {
        lines.push(`Skill: ${result.skillName}`);
      }
      if (result.startedAt) {
        lines.push(`Started: ${result.startedAt.toISOString()}`);
      }
      if (result.completedAt) {
        lines.push(`Completed: ${result.completedAt.toISOString()}`);
      }

      if (result.agentResult) {
        lines.push("");
        lines.push(formatAgentResult(result.agentResult));
      }

      if (result.error) {
        lines.push("");
        lines.push(`Error: ${result.error}`);
      }

      return lines.join("\n");
    },
  };
}

/** Validate input via zod and surface a `ToolValidationError` on failure. */
function parseInput(input: unknown): TaskQueryInput {
  const result = TaskQueryInputSchema.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError("Invalid TaskQuery input", result.error.issues);
  }
  return result.data;
}
