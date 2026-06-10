/**
 * Bounded concurrency task queue.
 *
 * Used by the coordinator to cap the number of sub-agents running in
 * parallel. New spawns wait in a FIFO queue until a slot opens.
 *
 * Design: simple mutex-style gate using a promise chain. Each task
 * acquires a "permit" before starting; releasing the permit unblocks
 * the next waiter.
 */

/** Options for {@link TaskQueue}. */
export interface TaskQueueOptions {
  /** Maximum number of concurrent tasks. */
  maxConcurrency: number;
}

/**
 * Semaphore-style queue that caps parallel work. Tasks submit via
 * `run(task)` and block until a permit is available.
 */
export class TaskQueue {
  private readonly maxConcurrency: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(opts: TaskQueueOptions) {
    this.maxConcurrency = Math.max(1, opts.maxConcurrency);
  }

  /**
   * Run a task with concurrency control. Returns the task's result.
   * If the queue is full, the caller awaits a permit before `task` runs.
   *
   * @param task - async function to execute under the permit.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  /** Number of tasks currently running. */
  get activeCount(): number {
    return this.active;
  }

  /** Number of tasks waiting for a permit. */
  get waitingCount(): number {
    return this.waiters.length;
  }

  /** Acquire a permit; blocks if at capacity. */
  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Release a permit and unblock the next waiter. */
  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) {
      this.active += 1;
      next();
    }
  }
}
