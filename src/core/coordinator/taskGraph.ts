/**
 * DAG task graph executor.
 *
 * Executes a task graph respecting dependencies. Tasks without dependencies
 * run in parallel (bounded by the spawn callback's concurrency control).
 * A task runs only after all its `dependsOn` tasks complete successfully.
 * Failed tasks cascade to dependents (skipped with error).
 */
import type {
  TaskGraph,
  TaskGraphResult,
  TaskNode,
  TaskState,
} from "./taskGraphTypes.js";
import type { AgentResult, SubAgentSpec } from "./types.js";
import type { TokenUsage } from "../../providers/types.js";

/**
 * Execute a task graph.
 *
 * @param graph - The task graph definition.
 * @param spawn - Callback to spawn a sub-agent. Returns AgentResult on completion.
 * @param signal - Abort signal to cancel execution.
 * @param parentId - ID of the parent agent that initiated the graph.
 * @param onTaskStateChange - Optional callback fired when a task's state changes.
 * @returns Aggregate result of all tasks.
 */
export async function executeTaskGraph(
  graph: TaskGraph,
  spawn: (spec: SubAgentSpec, signal: AbortSignal) => Promise<AgentResult>,
  signal: AbortSignal,
  parentId: string,
  onTaskStateChange?: (taskId: string, state: TaskState) => void,
): Promise<TaskGraphResult> {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  validateDAG(graph.nodes, nodeMap);

  const states = new Map<string, TaskState>();
  const started = new Set<string>();

  // Initialize all tasks as pending and notify.
  for (const node of graph.nodes) {
    const pendingState: TaskState = { id: node.id, status: "pending" };
    states.set(node.id, pendingState);
    onTaskStateChange?.(node.id, pendingState);
  }

  // Launch all tasks; each polls for its dependencies before running.
  const promises = graph.nodes.map((node) =>
    launchAndRun(node, states, started, spawn, signal, parentId, onTaskStateChange),
  );

  await Promise.all(promises);

  // Collect results.
  const tasks = Array.from(states.values());
  const overallSuccess = tasks.every((t) => t.status === "completed");
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for (const task of tasks) {
    if (task.result?.usage) {
      totalUsage.inputTokens += task.result.usage.inputTokens;
      totalUsage.outputTokens += task.result.usage.outputTokens;
    }
  }

  return { tasks, overallSuccess, totalUsage };
}

async function launchAndRun(
  node: TaskNode,
  states: Map<string, TaskState>,
  started: Set<string>,
  spawn: (spec: SubAgentSpec, signal: AbortSignal) => Promise<AgentResult>,
  signal: AbortSignal,
  parentId: string,
  onTaskStateChange?: (taskId: string, state: TaskState) => void,
): Promise<void> {
  // Wait for dependencies to complete.
  if (node.dependsOn && node.dependsOn.length > 0) {
    while (true) {
      const allDone = node.dependsOn.every((depId) => {
        const dep = states.get(depId);
        return dep && (dep.status === "completed" || dep.status === "failed" || dep.status === "skipped");
      });
      if (allDone) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    // Check if any dependency failed or was skipped.
    const failedDep = node.dependsOn.find((depId) => {
      const dep = states.get(depId);
      return dep && (dep.status === "failed" || dep.status === "skipped");
    });

    if (failedDep) {
      // Skip this task; its dependents will also skip when they check.
      const skipState: TaskState = {
        id: node.id,
        status: "skipped",
        error: `Dependency ${failedDep} failed`,
      };
      states.set(node.id, skipState);
      started.add(node.id);
      onTaskStateChange?.(node.id, skipState);
      return;
    }
  }

  // All dependencies met; run the task.
  // Use started set to prevent race: only one caller wins.
  if (started.has(node.id)) return;
  started.add(node.id);

  const runningState: TaskState = { id: node.id, status: "running" };
  states.set(node.id, runningState);
  onTaskStateChange?.(node.id, runningState);

  const spec: SubAgentSpec = {
    skillName: node.skillName,
    task: node.task,
    parentId,
    ...(node.modelOverride !== undefined ? { modelOverride: node.modelOverride } : {}),
    ...(node.toolAllowList !== undefined ? { toolAllowList: node.toolAllowList } : {}),
  };

  try {
    const result = await spawn(spec, signal);
    const completedState: TaskState = {
      id: node.id,
      status: result.success ? "completed" : "failed",
      result,
      ...(result.error !== undefined ? { error: result.error } : {}),
    };
    states.set(node.id, completedState);
    onTaskStateChange?.(node.id, completedState);
  } catch (err) {
    const failedState: TaskState = {
      id: node.id,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
    states.set(node.id, failedState);
    onTaskStateChange?.(node.id, failedState);
  }
}

function validateDAG(nodes: readonly TaskNode[], nodeMap: Map<string, TaskNode>): void {
  // Check all dependsOn references exist.
  for (const node of nodes) {
    if (node.dependsOn) {
      for (const depId of node.dependsOn) {
        if (!nodeMap.has(depId)) {
          throw new Error(`Task ${node.id} depends on unknown task ${depId}`);
        }
      }
    }
  }

  // Check for cycles via DFS with coloring.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const node of nodes) {
    color.set(node.id, WHITE);
  }

  function dfs(nodeId: string): void {
    color.set(nodeId, GRAY);
    const node = nodeMap.get(nodeId)!;
    if (node.dependsOn) {
      for (const depId of node.dependsOn) {
        if (color.get(depId) === GRAY) {
          throw new Error(`Cycle detected in task graph involving ${nodeId}`);
        }
        if (color.get(depId) === WHITE) {
          dfs(depId);
        }
      }
    }
    color.set(nodeId, BLACK);
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      dfs(node.id);
    }
  }
}
