/**
 * Coordinator.
 *
 * Supervisor layer above the agent loop. Responsibilities:
 *
 *   - Own the top-level agent's lifecycle.
 *   - Spawn sub-agents on demand (via `AgentSpawn` tool callback).
 *   - Enforce concurrency limits via `TaskQueue`.
 *   - Emit lifecycle events for the TUI and session writer.
 *   - Return sub-agent results to the spawning agent's tool_result.
 *
 * The coordinator does **not** own providers, registries, or permission
 * contexts — those are injected at construction. This keeps the
 * coordinator testable with mocks and re-usable across `chat` and `run`
 * subcommands.
 *
 * Sub-agent spawning flow:
 *   1. Agent calls `AgentSpawn` tool with a `SubAgentSpec`.
 *   2. Tool handler invokes `coordinator.spawn(spec)`.
 *   3. Coordinator acquires a queue permit, resolves the skill, compiles
 *      an `AgentConfig` + filtered registry.
 *   4. Coordinator constructs an `Agent`, runs `agent.send(spec.task)`,
 *      and collects the final result.
 *   5. Coordinator emits `spawn` + `complete`/`error` events.
 *   6. Returns `AgentResult` to the tool handler.
 */
import { Agent } from "../agent/agent.js";
import type { AgentConfig } from "../agent/types.js";
import { compileSkill } from "../skills/compiler.js";
import type { SkillRegistry } from "../skills/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { SessionWriter } from "../session/writer.js";
import { newAgentId } from "../../utils/idgen.js";
import type { Logger } from "../../utils/logger.js";
import { TaskQueue } from "./taskQueue.js";
import {
  type AgentResult,
  type CoordinatorEvent,
  type CoordinatorEventHandler,
  type ProviderResolver,
  type SubAgentSpec,
} from "./types.js";
import type { PermissionContext } from "../permissions/types.js";
import type { PromptHandler } from "../tools/executor.js";

/** Options for constructing a {@link Coordinator}. */
export interface CoordinatorOptions {
  /** Skill registry for resolving sub-agent specs. */
  skillRegistry: SkillRegistry;
  /** Full tool registry (sub-agents get filtered views). */
  toolRegistry: ToolRegistry;
  /** Provider factory keyed by provider id. */
  resolveProvider: ProviderResolver;
  /** Permission context shared by all agents. */
  permissionContext: PermissionContext;
  /** Prompt handler for permission prompts (TUI or headless). */
  promptHandler: PromptHandler;
  /** Session writer for JSONL transcript. */
  sessionWriter: SessionWriter;
  /** Logger. */
  log: Logger;
  /** Working directory for tool execution. */
  cwd: string;
  /** Default model for top-level and sub-agents. */
  defaultModel: string;
  /** Default provider id. */
  defaultProviderId: string;
  /** Maximum concurrent sub-agents. */
  maxConcurrentSubAgents: number;
  /** Handler for lifecycle events (optional). */
  onEvent?: CoordinatorEventHandler;
}

/**
 * Coordinator manages the top-level agent and its sub-agents.
 */
export class Coordinator {
  private readonly queue: TaskQueue;
  private readonly opts: CoordinatorOptions;

  constructor(opts: CoordinatorOptions) {
    this.opts = opts;
    this.queue = new TaskQueue({ maxConcurrency: opts.maxConcurrentSubAgents });
  }

  /**
   * Build the top-level agent. The CLI wiring layer calls this once and
   * runs `agent.send(userText)` for each user turn.
   *
   * @param agentId - id of the top-level agent.
   * @param systemPrompt - system prompt for the top-level agent.
   */
  buildTopLevelAgent(agentId: string, systemPrompt: string): Agent {
    const config: AgentConfig = {
      id: agentId,
      model: this.opts.defaultModel,
      providerId: this.opts.defaultProviderId,
      systemPrompt,
    };
    const executor = new ToolExecutor({
      registry: this.opts.toolRegistry,
      permissionContext: this.opts.permissionContext,
      promptHandler: this.opts.promptHandler,
      log: this.opts.log,
      cwd: this.opts.cwd,
      agentId,
    });
    const provider = this.opts.resolveProvider(this.opts.defaultProviderId);
    return new Agent(config, {
      provider,
      registry: this.opts.toolRegistry,
      executor,
      sessionWriter: this.opts.sessionWriter,
      log: this.opts.log,
    });
  }

  /**
   * Spawn a sub-agent per the given spec. Runs under the concurrency
   * queue. Returns the sub-agent's result to the caller (the AgentSpawn
   * tool handler).
   *
   * @param spec - sub-agent specification from the spawning agent.
   * @param signal - cancellation signal.
   */
  async spawn(spec: SubAgentSpec, signal: AbortSignal): Promise<AgentResult> {
    const { skillRegistry, log } = this.opts;
    const skill = skillRegistry.get(spec.skillName);
    if (!skill) {
      const errorMsg = `Unknown skill: ${spec.skillName}`;
      const result: AgentResult = {
        agentId: "",
        skillName: spec.skillName,
        finalText: "",
        usage: { inputTokens: 0, outputTokens: 0 },
        success: false,
        error: errorMsg,
      };
      await this.emit({ kind: "error", agentId: "", skillName: spec.skillName, error: errorMsg });
      return result;
    }

    return this.queue.run(async () => {
      const subAgentId = newAgentId();
      const modelOverride = spec.modelOverride ?? skill.model;
      const providerId = skill.provider ?? this.opts.defaultProviderId;

      // Apply spec-level tool override on top of skill's own allow-list.
      const compiled = compileSkill({
        skill,
        agentId: subAgentId,
        defaultModel: this.opts.defaultModel,
        defaultProviderId: this.opts.defaultProviderId,
        parentRegistry: this.opts.toolRegistry,
      });

      // Spec-level tool override takes precedence.
      const registry =
        spec.toolAllowList && spec.toolAllowList.length > 0
          ? this.opts.toolRegistry.filter(spec.toolAllowList)
          : compiled.registry;

      // Model override chain: spec > skill > default.
      const config: AgentConfig = {
        ...compiled.config,
        ...(modelOverride !== undefined ? { model: modelOverride } : {}),
      };

      await this.emit({
        kind: "spawn",
        agentId: subAgentId,
        skillName: spec.skillName,
        parentId: spec.parentId,
      });
      log.debug("sub-agent spawned", {
        agentId: subAgentId,
        skillName: spec.skillName,
        model: config.model,
        parentId: spec.parentId,
      });

      const executor = new ToolExecutor({
        registry,
        permissionContext: this.opts.permissionContext,
        promptHandler: this.opts.promptHandler,
        log: this.opts.log,
        cwd: this.opts.cwd,
        agentId: subAgentId,
      });

      const provider = this.opts.resolveProvider(providerId);
      const agent = new Agent(config, {
        provider,
        registry,
        executor,
        sessionWriter: this.opts.sessionWriter,
        log: this.opts.log,
      });

      try {
        let finalText = "";
        const usage = { inputTokens: 0, outputTokens: 0 };

        for await (const event of agent.send(spec.task, signal)) {
          if (event.kind === "text_delta") {
            finalText += event.delta;
          }
          if (event.kind === "turn_end") {
            usage.inputTokens += event.usage.inputTokens;
            usage.outputTokens += event.usage.outputTokens;
          }
          if (event.kind === "done") {
            finalText = event.result.finalText;
            usage.inputTokens = event.result.usage.inputTokens;
            usage.outputTokens = event.result.usage.outputTokens;
          }
          if (event.kind === "error") {
            throw new Error(event.error.message);
          }
        }

        const result: AgentResult = {
          agentId: subAgentId,
          skillName: spec.skillName,
          finalText,
          usage,
          success: true,
        };
        await this.emit({
          kind: "complete",
          agentId: subAgentId,
          skillName: spec.skillName,
          usage,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const result: AgentResult = {
          agentId: subAgentId,
          skillName: spec.skillName,
          finalText: "",
          usage: { inputTokens: 0, outputTokens: 0 },
          success: false,
          error: message,
        };
        await this.emit({
          kind: "error",
          agentId: subAgentId,
          skillName: spec.skillName,
          error: message,
        });
        return result;
      }
    });
  }

  /** Emit a lifecycle event to the handler and session writer. */
  private async emit(event: CoordinatorEvent): Promise<void> {
    await this.opts.onEvent?.(event);
    // Also write to session transcript as an agent_event.
    if (event.kind === "spawn") {
      await this.opts.sessionWriter.agentEvent({
        event: "spawned",
        agentId: event.agentId,
        data: { skillName: event.skillName, parentId: event.parentId },
      });
    } else if (event.kind === "complete") {
      await this.opts.sessionWriter.agentEvent({
        event: "stopped",
        agentId: event.agentId,
        data: { skillName: event.skillName, usage: event.usage },
      });
    } else if (event.kind === "error") {
      await this.opts.sessionWriter.agentEvent({
        event: "aborted",
        agentId: event.agentId,
        data: { skillName: event.skillName, error: event.error },
      });
    }
  }
}
