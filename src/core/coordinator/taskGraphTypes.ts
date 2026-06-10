/**
 * DAG task graph types for orchestrated sub-agent execution.
 *
 * Tasks have dependencies — a task runs only after all its
 * `dependsOn` tasks complete successfully. Failed tasks cascade
 * to dependents (they are skipped with an error).
 */
import type { AgentResult } from "./types.js";
import type { TokenUsage } from "../../providers/types.js";

/** A single node in a task graph. */
export interface TaskNode {
  /** Unique task identifier. */
  id: string;
  /** Skill to resolve from the registry. */
  skillName: string;
  /** Task prompt for the sub-agent. */
  task: string;
  /** IDs of prerequisite tasks (must all succeed before this runs). */
  dependsOn?: readonly string[];
  /** Optional model override. */
  modelOverride?: string;
  /** Optional tool allow-list override. */
  toolAllowList?: readonly string[];
}

/** A task graph definition. */
export interface TaskGraph {
  nodes: readonly TaskNode[];
}

/** Runtime status of a single task. */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** Runtime state of a single task. */
export interface TaskState {
  id: string;
  status: TaskStatus;
  result?: AgentResult;
  error?: string;
}

/** Aggregate result of executing an entire task graph. */
export interface TaskGraphResult {
  tasks: TaskState[];
  overallSuccess: boolean;
  totalUsage: TokenUsage;
}
