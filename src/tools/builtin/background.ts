/**
 * Background tool.
 *
 * Spawns a background agent that runs independently of the main
 * conversation. Returns the agent ID immediately so the main agent
 * can continue working. Results are stored in TaskResultStore and
 * can be queried later via TaskQuery.
 *
 * This is useful for long-running tasks that shouldn't block the
 * main conversation flow.
 */
import { z } from "zod";
import { ToolValidationError } from "../../core/tools/errors.js";
import type { Tool, ToolExecCtx } from "../../core/tools/types.js";
import type { Coordinator } from "../../core/coordinator/coordinator.js";
import type { BackgroundAgentManager } from "../../core/coordinator/backgroundAgentManager.js";

const BackgroundSchema = z.object({
  skillName: z.string().min(1),
  task: z.string().min(1),
  modelOverride: z.string().optional(),
  toolAllowList: z.array(z.string()).optional(),
});

export type BackgroundInput = z.infer<typeof BackgroundSchema>;

export function createBackgroundTool(
  coordinator: Coordinator,
  backgroundManager: BackgroundAgentManager,
  parentId: string,
): Tool<BackgroundInput, string> {
  return {
    name: "Background",
    description:
      "Spawn a background agent that runs independently. Returns an agent ID for querying results later via TaskQuery.",
    inputSchema: {
      type: "object",
      properties: {
        skillName: {
          type: "string",
          description: "Skill name for the background agent",
        },
        task: {
          type: "string",
          description: "Task description for the background agent",
        },
        modelOverride: {
          type: "string",
          description: "Optional model override",
        },
        toolAllowList: {
          type: "array",
          items: { type: "string" },
          description: "Optional tool allow list",
        },
      },
      required: ["skillName", "task"],
      additionalProperties: false,
    },
    destructive: false,
    source: "builtin",
    summarize(input) {
      return `Background: ${input.skillName} — ${input.task.slice(0, 40)}`;
    },
    async execute(input: BackgroundInput, ctx: ToolExecCtx): Promise<string> {
      const parsed = BackgroundSchema.safeParse(input);
      if (!parsed.success) {
        throw new ToolValidationError(
          `Invalid Background input: ${parsed.error.message}`,
        );
      }

      const { skillName, task, modelOverride, toolAllowList } = parsed.data;

      const agentId = backgroundManager.spawn(
        {
          skillName,
          task,
          parentId,
          ...(modelOverride !== undefined ? { modelOverride } : {}),
          ...(toolAllowList !== undefined ? { toolAllowList } : {}),
        },
        coordinator,
        ctx.signal,
      );

      return `Background agent ${agentId} spawned (${skillName}). Query results with TaskQuery.`;
    },
  };
}
