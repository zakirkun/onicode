/**
 * Background agent manager.
 *
 * Manages fire-and-forget background agents that run independently of
 * the main conversation. The main agent spawns a background agent
 * and continues chatting. When the background agent completes, its
 * result is stored in the shared TaskResultStore and a notification
 * is fired to the TUI.
 *
 * Results can be queried later via the TaskQuery tool.
 */
import type { Coordinator } from "./coordinator.js";
import type { AgentResult, SubAgentSpec } from "./types.js";
import type { TaskResultStore } from "../../tools/builtin/taskResultStore.js";
import { newAgentId } from "../../utils/idgen.js";

/** State of a single background agent. */
export interface BackgroundAgent {
  agentId: string;
  skillName: string;
  task: string;
  status: "running" | "completed" | "failed";
  result?: AgentResult;
  startedAt: Date;
  completedAt?: Date;
}

/** Notification callback fired when a background agent finishes. */
export type BackgroundNotification = (agent: BackgroundAgent) => void;

/**
 * Manager for fire-and-forget background agents.
 *
 * Background agents run independently of the main conversation.
 * The main agent can spawn them and continue chatting. When a
 * background agent completes, its result is stored and the TUI
 * shows a notification. Results can be queried via TaskQuery tool.
 */
export class BackgroundAgentManager {
  private readonly agents = new Map<string, BackgroundAgent>();
  private readonly handlers = new Set<BackgroundNotification>();
  private readonly resultStore: TaskResultStore;

  constructor(resultStore: TaskResultStore) {
    this.resultStore = resultStore;
  }

  /** Register a notification handler for when background agents finish. */
  onNotification(handler: BackgroundNotification): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  /**
   * Spawn a background agent. Returns the agent ID immediately;
   * the agent runs in the background. Results are stored in the
   * shared TaskResultStore when complete.
   *
   * @param spec - sub-agent specification.
   * @param coordinator - coordinator for spawning.
   * @param signal - cancellation signal.
   * @returns the background agent ID.
   */
  spawn(
    spec: SubAgentSpec,
    coordinator: Coordinator,
    signal: AbortSignal,
  ): string {
    const agentId = newAgentId();
    const bg: BackgroundAgent = {
      agentId,
      skillName: spec.skillName,
      task: spec.task,
      status: "running",
      startedAt: new Date(),
    };
    this.agents.set(agentId, bg);

    // Store initial "running" state in result store.
    this.resultStore.set({
      taskId: agentId,
      status: "running",
      skillName: spec.skillName,
      startedAt: bg.startedAt,
    });

    // Fire and forget — don't await.
    coordinator.spawn(spec, signal).then((result) => {
      bg.status = result.success ? "completed" : "failed";
      bg.result = result;
      bg.completedAt = new Date();

      // Update result store with final state.
      this.resultStore.set({
        taskId: agentId,
        status: bg.status,
        skillName: spec.skillName,
        startedAt: bg.startedAt,
        completedAt: bg.completedAt,
        agentResult: result,
        ...(result.error !== undefined ? { error: result.error } : {}),
      });

      this.notify(bg);
    }).catch((_err) => {
      bg.status = "failed";
      bg.completedAt = new Date();

      this.resultStore.set({
        taskId: agentId,
        status: "failed",
        skillName: spec.skillName,
        startedAt: bg.startedAt,
        completedAt: bg.completedAt,
        error: "Background agent threw an error",
      });

      this.notify(bg);
    });

    return agentId;
  }

  /** Look up a background agent by ID. */
  get(agentId: string): BackgroundAgent | undefined {
    return this.agents.get(agentId);
  }

  /** List all background agents. */
  list(): BackgroundAgent[] {
    return Array.from(this.agents.values());
  }

  /** Count of currently running background agents. */
  runningCount(): number {
    let count = 0;
    for (const bg of this.agents.values()) {
      if (bg.status === "running") count++;
    }
    return count;
  }

  private notify(agent: BackgroundAgent): void {
    for (const handler of this.handlers) {
      try { handler(agent); } catch { /* ignore handler errors */ }
    }
  }
}
