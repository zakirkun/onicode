import { describe, it, expect, vi } from "vitest";
import { executeTaskGraph } from "../../../src/core/coordinator/taskGraph.js";
import type { TaskGraph } from "../../../src/core/coordinator/taskGraphTypes.js";
import type { SubAgentSpec, AgentResult } from "../../../src/core/coordinator/types.js";

function mockSpawn(results: Map<string, AgentResult>): (spec: SubAgentSpec, signal: AbortSignal) => Promise<AgentResult> {
  return vi.fn(async (spec: SubAgentSpec) => {
    const result = results.get(spec.task);
    if (!result) throw new Error(`No mock result for task: ${spec.task}`);
    return result;
  });
}

function makeResult(success: boolean, task: string): AgentResult {
  return {
    agentId: `agent-${task}`,
    skillName: "test",
    finalText: success ? `Completed ${task}` : `Failed ${task}`,
    usage: { inputTokens: 100, outputTokens: 50 },
    success,
    ...(success ? {} : { error: "Task failed" }),
  };
}

describe("executeTaskGraph", () => {
  it("executes linear chain in dependency order", async () => {
    const graph: TaskGraph = {
      nodes: [
        { id: "A", skillName: "test", task: "taskA", dependsOn: ["B"] },
        { id: "B", skillName: "test", task: "taskB", dependsOn: ["C"] },
        { id: "C", skillName: "test", task: "taskC" },
      ],
    };

    const order: string[] = [];
    const spawn = vi.fn(async (spec: SubAgentSpec) => {
      order.push(spec.task);
      return makeResult(true, spec.task);
    });

    const result = await executeTaskGraph(
      graph,
      spawn,
      new AbortController().signal,
      "parent-1",
    );

    expect(order).toEqual(["taskC", "taskB", "taskA"]);
    expect(result.overallSuccess).toBe(true);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks.every((t) => t.status === "completed")).toBe(true);
  });

  it("executes independent tasks in parallel", async () => {
    const graph: TaskGraph = {
      nodes: [
        { id: "A", skillName: "test", task: "taskA" },
        { id: "B", skillName: "test", task: "taskB" },
        { id: "C", skillName: "test", task: "taskC" },
      ],
    };

    const results = new Map([
      ["taskA", makeResult(true, "taskA")],
      ["taskB", makeResult(true, "taskB")],
      ["taskC", makeResult(true, "taskC")],
    ]);

    const spawn = mockSpawn(results);
    const result = await executeTaskGraph(graph, spawn, new AbortController().signal, "parent-1");

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(result.overallSuccess).toBe(true);
  });

  it("skips dependents when dependency fails", async () => {
    const graph: TaskGraph = {
      nodes: [
        { id: "A", skillName: "test", task: "taskA", dependsOn: ["B"] },
        { id: "B", skillName: "test", task: "taskB" },
      ],
    };

    const results = new Map([
      ["taskB", makeResult(false, "taskB")],
    ]);

    const spawn = mockSpawn(results);
    const stateChanges: string[] = [];
    const onChange = (taskId: string, state: { status: string }) => {
      stateChanges.push(`${taskId}:${state.status}`);
    };

    const result = await executeTaskGraph(
      graph,
      spawn,
      new AbortController().signal,
      "parent-1",
      onChange,
    );

    expect(result.overallSuccess).toBe(false);
    const taskA = result.tasks.find((t) => t.id === "A");
    const taskB = result.tasks.find((t) => t.id === "B");
    expect(taskA?.status).toBe("skipped");
    expect(taskB?.status).toBe("failed");
    expect(stateChanges).toContain("A:skipped");
    expect(stateChanges).toContain("B:failed");
  });

  it("handles diamond dependency pattern", async () => {
    const graph: TaskGraph = {
      nodes: [
        { id: "A", skillName: "test", task: "taskA", dependsOn: ["B", "C"] },
        { id: "B", skillName: "test", task: "taskB", dependsOn: ["D"] },
        { id: "C", skillName: "test", task: "taskC", dependsOn: ["D"] },
        { id: "D", skillName: "test", task: "taskD" },
      ],
    };

    const order: string[] = [];
    const spawn = vi.fn(async (spec: SubAgentSpec) => {
      order.push(spec.task);
      return makeResult(true, spec.task);
    });

    await executeTaskGraph(graph, spawn, new AbortController().signal, "parent-1");

    expect(order[0]).toBe("taskD");
    expect(order.slice(1, 3).sort()).toEqual(["taskB", "taskC"].sort());
    expect(order[3]).toBe("taskA");
  });

  it("throws on cycle detection", async () => {
    const graph: TaskGraph = {
      nodes: [
        { id: "A", skillName: "test", task: "taskA", dependsOn: ["B"] },
        { id: "B", skillName: "test", task: "taskB", dependsOn: ["C"] },
        { id: "C", skillName: "test", task: "taskC", dependsOn: ["A"] },
      ],
    };

    const spawn = vi.fn();
    await expect(
      executeTaskGraph(graph, spawn, new AbortController().signal, "parent-1"),
    ).rejects.toThrow(/cycle/i);
  });

  it("throws on invalid dependency reference", async () => {
    const graph: TaskGraph = {
      nodes: [
        { id: "A", skillName: "test", task: "taskA", dependsOn: ["X"] },
      ],
    };

    const spawn = vi.fn();
    await expect(
      executeTaskGraph(graph, spawn, new AbortController().signal, "parent-1"),
    ).rejects.toThrow(/unknown task X/i);
  });

  it("calls onTaskStateChange for each state transition", async () => {
    const graph: TaskGraph = {
      nodes: [{ id: "A", skillName: "test", task: "taskA" }],
    };

    const results = new Map([["taskA", makeResult(true, "taskA")]]);
    const spawn = mockSpawn(results);
    const changes: Array<{ taskId: string; status: string }> = [];

    await executeTaskGraph(
      graph,
      spawn,
      new AbortController().signal,
      "parent-1",
      (taskId, state) => changes.push({ taskId, status: state.status }),
    );

    expect(changes).toEqual([
      { taskId: "A", status: "pending" },
      { taskId: "A", status: "running" },
      { taskId: "A", status: "completed" },
    ]);
  });

  it("aggregates token usage across tasks", async () => {
    const graph: TaskGraph = {
      nodes: [
        { id: "A", skillName: "test", task: "taskA" },
        { id: "B", skillName: "test", task: "taskB" },
      ],
    };

    const results = new Map([
      ["taskA", makeResult(true, "taskA")],
      ["taskB", makeResult(true, "taskB")],
    ]);

    const spawn = mockSpawn(results);
    const result = await executeTaskGraph(graph, spawn, new AbortController().signal, "parent-1");

    expect(result.totalUsage.inputTokens).toBe(200);
    expect(result.totalUsage.outputTokens).toBe(100);
  });

  it("passes modelOverride and toolAllowList to sub-agent spec", async () => {
    const graph: TaskGraph = {
      nodes: [
        {
          id: "A",
          skillName: "explorer",
          task: "taskA",
          modelOverride: "gpt-4",
          toolAllowList: ["Read", "Glob"],
        },
      ],
    };

    const spawn = vi.fn(async (spec: SubAgentSpec) => {
      expect(spec.modelOverride).toBe("gpt-4");
      expect(spec.toolAllowList).toEqual(["Read", "Glob"]);
      return makeResult(true, spec.task);
    });

    await executeTaskGraph(graph, spawn, new AbortController().signal, "parent-1");
    expect(spawn).toHaveBeenCalled();
  });
});
