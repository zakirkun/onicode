/**
 * Shared store for spawned task results.
 *
 * Both TaskSpawn (DAG) and Background agents write their results here.
 * TaskQuery reads from this store. Lives for the lifetime of the session.
 */
import type { AgentResult } from "../../core/coordinator/types.js";

/** Stored result of a single spawned task. */
export interface TaskQueryResult {
  taskId: string;
  status: "running" | "completed" | "failed" | "skipped";
  skillName?: string;
  startedAt?: Date;
  completedAt?: Date;
  agentResult?: AgentResult;
  error?: string;
}

/** Simple in-memory result store keyed by task ID. */
export class TaskResultStore {
  private readonly store = new Map<string, TaskQueryResult>();

  /** Store or update a task result. */
  set(result: TaskQueryResult): void {
    this.store.set(result.taskId, result);
  }

  /** Look up a task result by ID. */
  get(taskId: string): TaskQueryResult | undefined {
    return this.store.get(taskId);
  }

  /** List all stored task results. */
  list(): TaskQueryResult[] {
    return Array.from(this.store.values());
  }

  /** Check if a task exists in the store. */
  has(taskId: string): boolean {
    return this.store.has(taskId);
  }
}
