import { describe, it, expect, vi } from "vitest";
import { BackgroundAgentManager } from "../../../src/core/coordinator/backgroundAgentManager.js";
import { TaskResultStore } from "../../../src/tools/builtin/taskResultStore.js";
import type { AgentResult, SubAgentSpec } from "../../../src/core/coordinator/types.js";

function mockCoordinator(
  handler: (spec: SubAgentSpec) => Promise<AgentResult>,
): any {
  return {
    spawn: vi.fn(handler),
  };
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

describe("BackgroundAgentManager", () => {
  it("spawn() returns agentId immediately", () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(
      () => new Promise(() => {}), // never resolves
    );

    const id = mgr.spawn(
      { skillName: "test", task: "bg-task", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    const bg = mgr.get(id);
    expect(bg).toBeDefined();
    expect(bg!.status).toBe("running");
  });

  it("stores completed result after agent finishes", async () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(async (spec) => makeResult(true, spec.task));

    const id = mgr.spawn(
      { skillName: "test", task: "bg-task", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    // Wait for promise microtasks to flush.
    await new Promise((r) => setTimeout(r, 50));

    const bg = mgr.get(id);
    expect(bg!.status).toBe("completed");
    expect(bg!.result).toBeDefined();
    expect(bg!.result!.finalText).toBe("Completed bg-task");

    // Result store updated too.
    const stored = store.get(id);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("completed");
    expect(stored!.agentResult).toBeDefined();
  });

  it("stores failed result when agent fails", async () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(async (spec) => makeResult(false, spec.task));

    const id = mgr.spawn(
      { skillName: "test", task: "bg-task", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    await new Promise((r) => setTimeout(r, 50));

    const bg = mgr.get(id);
    expect(bg!.status).toBe("failed");
    expect(bg!.result!.error).toBe("Task failed");

    const stored = store.get(id);
    expect(stored!.status).toBe("failed");
    expect(stored!.error).toBe("Task failed");
  });

  it("stores failed result when agent throws", async () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(async () => {
      throw new Error("spawn blew up");
    });

    const id = mgr.spawn(
      { skillName: "test", task: "bg-task", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    await new Promise((r) => setTimeout(r, 50));

    const bg = mgr.get(id);
    expect(bg!.status).toBe("failed");
    expect(bg!.completedAt).toBeDefined();

    const stored = store.get(id);
    expect(stored!.status).toBe("failed");
    expect(stored!.error).toBe("Background agent threw an error");
  });

  it("list() returns all background agents", async () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(
      () => new Promise(() => {}), // never resolves
    );

    const id1 = mgr.spawn(
      { skillName: "a", task: "t1", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );
    const id2 = mgr.spawn(
      { skillName: "b", task: "t2", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    const list = mgr.list();
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.agentId).sort()).toEqual([id1, id2].sort());
  });

  it("fires notification handler on completion", async () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(async (spec) => makeResult(true, spec.task));

    const notifications: string[] = [];
    mgr.onNotification((bg) => notifications.push(`${bg.agentId}:${bg.status}`));

    mgr.spawn(
      { skillName: "test", task: "bg-task", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.endsWith(":completed")).toBe(true);
  });

  it("fires multiple notification handlers", async () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(async (spec) => makeResult(true, spec.task));

    let count1 = 0;
    let count2 = 0;
    mgr.onNotification(() => { count1++; });
    mgr.onNotification(() => { count2++; });

    mgr.spawn(
      { skillName: "test", task: "bg-task", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it("unsubscribe removes notification handler", async () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(async (spec) => makeResult(true, spec.task));

    let count = 0;
    const unsub = mgr.onNotification(() => { count++; });
    unsub();

    mgr.spawn(
      { skillName: "test", task: "bg-task", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(count).toBe(0);
  });

  it("runningCount() tracks active agents", async () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    let resolveA: ((v: AgentResult) => void) | null = null;
    const coordinator = {
      spawn: vi.fn(async (spec: SubAgentSpec) => {
        if (spec.task === "t1") {
          return new Promise<AgentResult>((r) => { resolveA = r; });
        }
        return makeResult(true, spec.task);
      }),
    };

    mgr.spawn(
      { skillName: "a", task: "t1", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );
    mgr.spawn(
      { skillName: "b", task: "t2", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    // t1 is still running, t2 completed
    await new Promise((r) => setTimeout(r, 50));
    expect(mgr.runningCount()).toBe(1);

    resolveA!(makeResult(true, "t1"));
    await new Promise((r) => setTimeout(r, 50));
    expect(mgr.runningCount()).toBe(0);
  });

  it("handler errors are swallowed", async () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(async (spec) => makeResult(true, spec.task));

    mgr.onNotification(() => { throw new Error("handler boom"); });
    let count = 0;
    mgr.onNotification(() => { count++; });

    mgr.spawn(
      { skillName: "test", task: "bg-task", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    await new Promise((r) => setTimeout(r, 50));

    // Second handler still fires despite first throwing.
    expect(count).toBe(1);
  });

  it("stores initial running state in result store", () => {
    const store = new TaskResultStore();
    const mgr = new BackgroundAgentManager(store);
    const coordinator = mockCoordinator(() => new Promise(() => {}));

    const id = mgr.spawn(
      { skillName: "test", task: "bg-task", parentId: "p1" },
      coordinator,
      new AbortController().signal,
    );

    const stored = store.get(id);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe("running");
    expect(stored!.skillName).toBe("test");
    expect(stored!.startedAt).toBeInstanceOf(Date);
  });
});
