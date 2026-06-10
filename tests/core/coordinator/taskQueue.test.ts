import { describe, it, expect } from "vitest";
import { TaskQueue } from "../../../src/core/coordinator/taskQueue.js";

/**
 * Helper: a deferred promise that can be resolved externally.
 */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Helper: a short async delay so microtasks can flush.
 */
function delay(ms = 10): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("TaskQueue", () => {
  describe("tasks run immediately when under limit", () => {
    it("runs a single task right away", async () => {
      const queue = new TaskQueue({ maxConcurrency: 2 });
      let ran = false;
      await queue.run(async () => {
        ran = true;
        return 42;
      });
      expect(ran).toBe(true);
    });

    it("runs multiple tasks concurrently up to the limit", async () => {
      const queue = new TaskQueue({ maxConcurrency: 3 });
      const gate = deferred();
      const started: number[] = [];

      const task = (id: number) =>
        queue.run(async () => {
          started.push(id);
          await gate.promise;
          return id;
        });

      const p1 = task(1);
      const p2 = task(2);
      const p3 = task(3);

      // Give microtasks time to start
      await delay();

      expect(started).toEqual([1, 2, 3]);
      expect(queue.activeCount).toBe(3);

      gate.resolve();
      await Promise.all([p1, p2, p3]);
    });

    it("returns the task result", async () => {
      const queue = new TaskQueue({ maxConcurrency: 1 });
      const result = await queue.run(async () => "hello");
      expect(result).toBe("hello");
    });
  });

  describe("tasks queue when at limit", () => {
    it("queues a task when all slots are occupied", async () => {
      const queue = new TaskQueue({ maxConcurrency: 1 });
      const gate = deferred();

      const p1 = queue.run(async () => {
        await gate.promise;
        return "first";
      });

      // Wait for p1 to start
      await delay();
      expect(queue.activeCount).toBe(1);

      const p2 = queue.run(async () => "second");

      // p2 should be waiting, not started
      await delay();
      expect(queue.waitingCount).toBe(1);
      expect(queue.activeCount).toBe(1);

      gate.resolve();
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe("first");
      expect(r2).toBe("second");
    });

    it("multiple tasks queue up when over limit", async () => {
      const queue = new TaskQueue({ maxConcurrency: 1 });
      const gate = deferred();

      const p1 = queue.run(async () => {
        await gate.promise;
        return 1;
      });

      await delay();

      const p2 = queue.run(async () => 2);
      const p3 = queue.run(async () => 3);

      await delay();
      expect(queue.waitingCount).toBe(2);

      gate.resolve();
      const results = await Promise.all([p1, p2, p3]);
      expect(results).toEqual([1, 2, 3]);
    });
  });

  describe("FIFO ordering of queued tasks", () => {
    it("runs queued tasks in submission order", async () => {
      const queue = new TaskQueue({ maxConcurrency: 1 });
      const order: number[] = [];

      const gate = deferred();

      const p1 = queue.run(async () => {
        await gate.promise;
        order.push(1);
      });

      await delay();

      const p2 = queue.run(async () => {
        order.push(2);
      });
      const p3 = queue.run(async () => {
        order.push(3);
      });
      const p4 = queue.run(async () => {
        order.push(4);
      });

      // Release the first task
      gate.resolve();

      await Promise.all([p1, p2, p3, p4]);
      expect(order).toEqual([1, 2, 3, 4]);
    });

    it("maintains FIFO across multiple release cycles", async () => {
      const queue = new TaskQueue({ maxConcurrency: 2 });
      const order: string[] = [];
      const gateA = deferred();
      const gateB = deferred();

      // Fill both slots with tasks we control independently
      const pA = queue.run(async () => {
        await gateA.promise;
        order.push("A");
      });
      const pB = queue.run(async () => {
        await gateB.promise;
        order.push("B");
      });

      await delay();

      // Queue C, D, E — they should be served FIFO as slots free up
      const pC = queue.run(async () => {
        order.push("C");
      });
      const pD = queue.run(async () => {
        order.push("D");
      });
      const pE = queue.run(async () => {
        order.push("E");
      });

      await delay();
      expect(queue.waitingCount).toBe(3);

      // Release slot A first — C (first waiter) should start
      gateA.resolve();
      await pA;
      await delay();
      expect(order).toContain("A");
      expect(order).toContain("C");

      // Now release slot B — D (second waiter) should start next
      gateB.resolve();
      await pB;
      await delay();

      await Promise.all([pC, pD, pE]);

      // Verify FIFO: C ran before D, D ran before E,
      // and each ran only after a slot freed up.
      const idxC = order.indexOf("C");
      const idxD = order.indexOf("D");
      const idxE = order.indexOf("E");
      expect(idxC).toBeLessThan(idxD);
      expect(idxD).toBeLessThan(idxE);
    });
  });

  describe("release allows next queued task to run", () => {
    it("decrements active count on release and starts next waiter", async () => {
      const queue = new TaskQueue({ maxConcurrency: 1 });
      const gate1 = deferred();
      const gate2 = deferred();

      const p1 = queue.run(async () => {
        await gate1.promise;
      });

      await delay();
      expect(queue.activeCount).toBe(1);

      const p2 = queue.run(async () => {
        await gate2.promise;
      });

      await delay();
      expect(queue.waitingCount).toBe(1);

      // Release p1
      gate1.resolve();
      await p1;

      // After release, p2 should be running
      await delay();
      expect(queue.waitingCount).toBe(0);
      expect(queue.activeCount).toBe(1);

      gate2.resolve();
      await p2;
      expect(queue.activeCount).toBe(0);
    });

    it("releases even when a task throws", async () => {
      const queue = new TaskQueue({ maxConcurrency: 1 });
      const gate = deferred();

      const p1 = queue.run(async () => {
        await gate.promise;
        throw new Error("boom");
      });

      await delay();

      const p2 = queue.run(async () => "recovered");

      gate.resolve();

      await expect(p1).rejects.toThrow("boom");

      const result = await p2;
      expect(result).toBe("recovered");
      expect(queue.activeCount).toBe(0);
    });

    it("releases even when a waiting task throws", async () => {
      const queue = new TaskQueue({ maxConcurrency: 1 });
      const gate = deferred();

      const p1 = queue.run(async () => {
        await gate.promise;
      });

      await delay();

      const p2 = queue.run(async () => {
        throw new Error("task2 failed");
      });

      const p3 = queue.run(async () => "third");

      gate.resolve();
      await p1;
      await expect(p2).rejects.toThrow("task2 failed");

      const result = await p3;
      expect(result).toBe("third");
      expect(queue.activeCount).toBe(0);
    });

    it("queue fully drains after all tasks complete", async () => {
      const queue = new TaskQueue({ maxConcurrency: 2 });

      const results = await Promise.all(
        [1, 2, 3, 4, 5].map((n) => queue.run(async () => n * 2)),
      );

      expect(results).toEqual([2, 4, 6, 8, 10]);
      expect(queue.activeCount).toBe(0);
      expect(queue.waitingCount).toBe(0);
    });
  });

  describe("zero/negative concurrency limit handling", () => {
    it("treats maxConcurrency 0 as 1", async () => {
      const queue = new TaskQueue({ maxConcurrency: 0 });
      let ran = false;
      await queue.run(async () => {
        ran = true;
      });
      expect(ran).toBe(true);
    });

    it("treats negative maxConcurrency as 1", async () => {
      const queue = new TaskQueue({ maxConcurrency: -5 });
      let ran = false;
      await queue.run(async () => {
        ran = true;
      });
      expect(ran).toBe(true);
    });

    it("with clamped concurrency of 1, tasks run sequentially", async () => {
      const queue = new TaskQueue({ maxConcurrency: 0 });
      const order: number[] = [];
      const gate = deferred();

      const p1 = queue.run(async () => {
        await gate.promise;
        order.push(1);
      });

      await delay();

      const p2 = queue.run(async () => {
        order.push(2);
      });

      await delay();
      // Only one slot, so p2 must be waiting
      expect(queue.waitingCount).toBe(1);
      expect(queue.activeCount).toBe(1);

      gate.resolve();
      await Promise.all([p1, p2]);
      expect(order).toEqual([1, 2]);
    });
  });
});
