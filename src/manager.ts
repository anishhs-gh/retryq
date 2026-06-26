import { EventEmitter } from "node:events";
import type {
  CancelableFunction,
  JobListSnapshot,
  JobState,
  JobSummary,
  RetryInfo,
  RetryQEvents,
  RetryQJob,
  RetryQJobOptions,
  RetryQManagerConfig,
} from "./types.js";
import { clamp, randomId, RetryQTimeoutError, sleep } from "./utils.js";
import { resolveOptions } from "./validation.js";

/**
 * In-memory retry queue manager with concurrency control, priority scheduling,
 * exponential backoff with jitter, lifecycle events, cooperative/force
 * cancellation, and bounded job history.
 *
 * The manager extends {@link EventEmitter}; subscribe to `retry`, `success`,
 * `failure`, `cancel`, and `idle` events (see {@link RetryQEvents}).
 *
 * @example
 * ```ts
 * const q = new RetryQManager({ maxConcurrent: 3 });
 * q.on("failure", ({ job, error }) => console.error(job.label, error));
 *
 * const job = q.createJob(async (signal) => {
 *   const res = await fetch("https://api.example.com", { signal });
 *   if (!res.ok) throw new Error(`HTTP ${res.status}`);
 *   return res.json();
 * }, { retries: 5, shouldRetry: (e) => !`${e}`.includes("404") });
 *
 * await job.promise;
 * await q.onIdle();
 * ```
 */
export class RetryQManager extends EventEmitter {
  private pendingQueue: RetryQJob<any>[] = [];
  private runningJobs: Map<string, RetryQJob<any>> = new Map();
  private failedJobs: Map<string, RetryQJob<any>> = new Map();
  private completedJobs: Map<string, RetryQJob<any>> = new Map();
  private cancelledJobs: Map<string, RetryQJob<any>> = new Map();
  private maxConcurrent: number;
  private maxHistorySize: number;
  private registry: Map<string, CancelableFunction> = new Map();
  /** Cleanup callbacks (e.g. external-signal listener removal) keyed by job id. */
  private cleanups: Map<string, () => void> = new Map();
  /** Resolvers waiting for the queue to become idle. */
  private idleWaiters: Array<() => void> = [];
  /** Tracks idle state so the `idle` event only fires on transition. */
  private wasIdle = true;

  /**
   * @param config - Manager configuration, or a number for `maxConcurrent`
   *   (legacy form, kept for backwards compatibility).
   */
  constructor(config: RetryQManagerConfig | number = {}) {
    super();
    // Support legacy number parameter for backwards compatibility
    if (typeof config === "number") {
      this.maxConcurrent = config;
      this.maxHistorySize = 1000;
    } else {
      this.maxConcurrent = config.maxConcurrent ?? Infinity;
      this.maxHistorySize = config.maxHistorySize ?? 1000;
    }
  }

  // ---------------------------------------------------------------------------
  // Typed event API (overrides EventEmitter with strongly-typed signatures)
  // ---------------------------------------------------------------------------

  /** Subscribe to a manager event. See {@link RetryQEvents}. */
  on<E extends keyof RetryQEvents>(event: E, listener: RetryQEvents[E]): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  on(event: any, listener: any): this {
    return super.on(event, listener);
  }

  /** Subscribe to a manager event once. See {@link RetryQEvents}. */
  once<E extends keyof RetryQEvents>(event: E, listener: RetryQEvents[E]): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: any, listener: any): this {
    return super.once(event, listener);
  }

  /** Remove a previously registered listener. See {@link RetryQEvents}. */
  off<E extends keyof RetryQEvents>(event: E, listener: RetryQEvents[E]): this;
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  off(event: any, listener: any): this {
    return super.off(event, listener);
  }

  /** Emit a manager event. See {@link RetryQEvents}. */
  emit<E extends keyof RetryQEvents>(
    event: E,
    ...args: Parameters<RetryQEvents[E]>
  ): boolean;
  emit(event: string | symbol, ...args: any[]): boolean;
  emit(event: any, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create and immediately enqueue a job.
   *
   * @typeParam T - Resolved value produced by `fn`.
   * @param fn - Async function to run. Receives an {@link AbortSignal} that
   *   aborts on force-cancellation or attempt/`maxTime` timeout.
   * @param options - Per-job configuration (see {@link RetryQJobOptions}).
   * @returns The created {@link RetryQJob}. Await `job.promise` for the result.
   * @throws {Error} If any option fails validation.
   */
  createJob<T>(
    fn: (signal?: AbortSignal) => Promise<T>,
    options: RetryQJobOptions<T> = {}
  ): RetryQJob<T> {
    const resolved = resolveOptions(options);
    const id = randomId();

    // Internal AbortController drives force cancellation and timeouts.
    const abortController = new AbortController();

    // Link an external signal to the internal controller, and remember how to
    // detach the listener once the job settles (prevents listener leaks).
    if (options.signal) {
      const external = options.signal;
      const onExternalAbort = () => {
        if (!abortController.signal.aborted) {
          abortController.abort((external as any).reason);
        }
      };
      if (external.aborted) {
        onExternalAbort();
      } else {
        external.addEventListener("abort", onExternalAbort, { once: true });
        this.cleanups.set(id, () =>
          external.removeEventListener("abort", onExternalAbort)
        );
      }
    }

    const job: RetryQJob<T> = {
      id,
      label: options.label || id,
      state: "pending",
      priority: resolved.priority,
      retriesLeft: resolved.retries + 1, // +1 for the initial attempt
      promise: Promise.resolve() as Promise<T>, // placeholder, replaced below
      cancel: (force?: boolean) => this.cancelJob(id, force),
      fn,
      options: { ...options, ...resolved },
      createdAt: Date.now(),
      abortController,
    };

    // Enqueue BEFORE starting execution so state is always consistent.
    this.pendingQueue.push(job);
    this._sortQueue();
    this.wasIdle = false;

    job.promise = this._runJob(job);
    // Prevent unhandled rejections if the consumer never attaches `.catch()`;
    // the error is still available via `job.error`.
    job.promise.catch(() => {});

    this._processQueue();
    return job;
  }

  /**
   * Cancel a pending or running job.
   *
   * Cooperative (default) cancellation stops future retries and interrupts the
   * delay between them. Force cancellation additionally aborts the in-flight
   * attempt via its {@link AbortSignal}.
   *
   * @param id - Id of the job to cancel.
   * @param force - When `true`, abort in-progress execution. Defaults to `false`.
   */
  cancelJob(id: string, force: boolean = false): void {
    const job =
      this.runningJobs.get(id) || this.pendingQueue.find((j) => j.id === id);
    if (!job) return;

    job.state = "cancelled";
    job.error = new Error("Job cancelled");
    job.finishedAt = Date.now();

    if (force && job.abortController && !job.abortController.signal.aborted) {
      job.abortController.abort(new Error("Job forcefully cancelled"));
    }

    this.runningJobs.delete(id);
    this.pendingQueue = this.pendingQueue.filter((j) => j.id !== id);

    this._evictOldest(this.cancelledJobs);
    this.cancelledJobs.set(id, job);

    const cancelFn = this.registry.get(id);
    cancelFn?.cancelSleep?.();
    this.registry.delete(id);
    this._runCleanup(id);

    job.options.onCancel?.();
    this.emit("cancel", { job });

    this._processQueue();
    this._checkIdle();
  }

  /**
   * Returns a promise that resolves when the queue is fully idle — no pending
   * and no running jobs. Resolves immediately if already idle.
   *
   * @returns A promise that resolves on idle.
   */
  onIdle(): Promise<void> {
    if (this._isIdle()) return Promise.resolve();
    return new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  /**
   * Alias for {@link RetryQManager.onIdle}.
   * @returns A promise that resolves when the queue is idle.
   */
  drain(): Promise<void> {
    return this.onIdle();
  }

  /**
   * Clear retained job history.
   *
   * @param state - Optional terminal state to clear (`completed`, `failed`, or
   *   `cancelled`). When omitted, all history is cleared.
   */
  clearHistory(state?: JobState): void {
    if (!state || state === "failed") this.failedJobs.clear();
    if (!state || state === "completed") this.completedJobs.clear();
    if (!state || state === "cancelled") this.cancelledJobs.clear();
  }

  /**
   * Snapshot of all jobs grouped by state.
   * @returns A {@link JobListSnapshot}.
   */
  listJobs(): JobListSnapshot {
    return {
      pending: this.pendingQueue.map((j) => this._jobSummary(j)),
      running: Array.from(this.runningJobs.values()).map((j) =>
        this._jobSummary(j)
      ),
      failed: Array.from(this.failedJobs.values()).map((j) =>
        this._jobSummary(j)
      ),
      completed: Array.from(this.completedJobs.values()).map((j) =>
        this._jobSummary(j)
      ),
      cancelled: Array.from(this.cancelledJobs.values()).map((j) =>
        this._jobSummary(j)
      ),
    };
  }

  /**
   * Find a job by id across every state.
   * @param id - Job id.
   * @returns The job, or `null` if not found.
   */
  findJobById(id: string): RetryQJob | null {
    return (
      this.runningJobs.get(id) ||
      this.pendingQueue.find((j) => j.id === id) ||
      this.failedJobs.get(id) ||
      this.completedJobs.get(id) ||
      this.cancelledJobs.get(id) ||
      null
    );
  }

  /**
   * Find all jobs (across every state) with a matching label.
   * @param label - Label to match.
   * @returns Matching jobs.
   */
  findJobsByLabel(label: string): RetryQJob[] {
    const all = [
      ...Array.from(this.runningJobs.values()),
      ...this.pendingQueue,
      ...Array.from(this.failedJobs.values()),
      ...Array.from(this.completedJobs.values()),
      ...Array.from(this.cancelledJobs.values()),
    ];
    return all.filter((j) => j.label === label);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Evict the oldest entry from a history map when it reaches the size cap. */
  private _evictOldest(map: Map<string, RetryQJob<any>>): void {
    if (map.size >= this.maxHistorySize) {
      const oldest = map.keys().next().value;
      if (oldest) map.delete(oldest);
    }
  }

  /** Sort the pending queue by descending priority (stable: FIFO within a tier). */
  private _sortQueue(): void {
    this.pendingQueue.sort((a, b) => b.priority - a.priority);
  }

  /** Promote pending jobs into running while capacity allows (synchronous). */
  private _processQueue(): void {
    while (
      this.runningJobs.size < this.maxConcurrent &&
      this.pendingQueue.length > 0
    ) {
      const job = this.pendingQueue.shift()!;
      this.runningJobs.set(job.id, job);
    }
  }

  private _isIdle(): boolean {
    return this.pendingQueue.length === 0 && this.runningJobs.size === 0;
  }

  /** Resolve idle waiters and emit `idle` once when the queue drains. */
  private _checkIdle(): void {
    if (!this._isIdle()) {
      this.wasIdle = false;
      return;
    }
    if (this.wasIdle) return; // already idle; don't fire twice
    this.wasIdle = true;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
    this.emit("idle");
  }

  /** Run and remove a job's cleanup callback, if any. */
  private _runCleanup(id: string): void {
    const cleanup = this.cleanups.get(id);
    if (cleanup) {
      cleanup();
      this.cleanups.delete(id);
    }
  }

  /**
   * Execute a single attempt, bounded by `timeoutMs`. A per-attempt
   * AbortController is linked to the job's controller so force-cancellation
   * still propagates, while a timeout aborts only this attempt (leaving the job
   * free to retry). Uses `Promise.race` so the loop advances even if `fn`
   * ignores the signal.
   */
  private _runAttempt<T>(job: RetryQJob<T>, timeoutMs: number): Promise<T> {
    const jobSignal = job.abortController?.signal;

    if (!isFinite(timeoutMs)) {
      return job.fn(jobSignal);
    }

    const attemptController = new AbortController();
    const onJobAbort = () => attemptController.abort((jobSignal as any)?.reason);

    if (jobSignal) {
      if (jobSignal.aborted) {
        attemptController.abort((jobSignal as any).reason);
      } else {
        jobSignal.addEventListener("abort", onJobAbort, { once: true });
      }
    }

    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        attemptController.abort(new RetryQTimeoutError(timeoutMs));
        reject(new RetryQTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    return Promise.race([job.fn(attemptController.signal), timeout]).finally(
      () => {
        clearTimeout(timer);
        jobSignal?.removeEventListener("abort", onJobAbort);
      }
    ) as Promise<T>;
  }

  /** Core retry loop for a single job. */
  private async _runJob<T>(job: RetryQJob<T>): Promise<T> {
    // Wait until _processQueue() has granted this job a concurrency slot.
    while (!this.runningJobs.has(job.id)) {
      if (job.state === "cancelled") {
        throw job.error ?? new Error("Job cancelled");
      }
      if (job.abortController?.signal.aborted) {
        job.state = "cancelled";
        job.error = new Error("Job cancelled via abort signal");
        throw job.error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    job.state = "running";
    job.startedAt = Date.now();

    const cancelFn: CancelableFunction = () => {};
    this.registry.set(job.id, cancelFn);

    const { delay, backoff, maxTime, maxDelay, jitter, attemptTimeout } =
      resolveOptions(job.options);
    let currentDelay = delay;
    let attempt = 0;

    try {
      while (job.retriesLeft > 0) {
        if ((job.state as JobState) === "cancelled") break;
        if (job.abortController?.signal.aborted) {
          job.state = "cancelled";
          job.error = new Error("Job cancelled via abort signal");
          break;
        }

        const elapsed = Date.now() - (job.startedAt ?? Date.now());
        const remaining = maxTime - elapsed;
        if (remaining <= 0) break; // overall time budget exhausted

        attempt++;
        const effectiveTimeout = Math.min(attemptTimeout, remaining);

        try {
          const result = await this._runAttempt(job, effectiveTimeout);
          if ((job.state as JobState) === "cancelled") break;

          job.state = "completed";
          job.finishedAt = Date.now();
          this._evictOldest(this.completedJobs);
          this.completedJobs.set(job.id, job);

          job.options.onSuccess?.(result);
          this.emit("success", { job, result });
          return result;
        } catch (err) {
          job.retriesLeft--;
          job.error = err;

          if ((job.state as JobState) === "cancelled") break;
          if (job.abortController?.signal.aborted) {
            job.state = "cancelled";
            break;
          }

          // Honour the retry predicate, if supplied.
          if (job.options.shouldRetry && !job.options.shouldRetry(err, attempt)) {
            break;
          }
          if (job.retriesLeft <= 0) break;

          // Compute the next delay: cap, jitter, then clamp to remaining budget.
          const elapsedNow = Date.now() - (job.startedAt ?? Date.now());
          const cappedDelay = Math.min(currentDelay, maxDelay);
          const jitterAmount = cappedDelay * jitter;
          const nextDelay = clamp(
            cappedDelay + (Math.random() * 2 - 1) * jitterAmount,
            0,
            Math.max(0, maxTime - elapsedNow)
          );

          const info: RetryInfo = {
            attempt,
            error: err,
            nextDelay,
            retriesLeft: job.retriesLeft,
          };
          job.options.onRetry?.(info);
          this.emit("retry", { job, info });

          if (nextDelay > 0) await sleep(nextDelay, cancelFn);
          currentDelay *= backoff;
        }
      }

      // Loop exited without a successful return.
      if ((job.state as JobState) === "cancelled") {
        throw job.error ?? new Error("Job cancelled");
      }

      job.state = "failed";
      job.finishedAt = Date.now();
      this._evictOldest(this.failedJobs);
      this.failedJobs.set(job.id, job);

      job.options.onFailure?.(job.error);
      this.emit("failure", { job, error: job.error });
      throw job.error ?? new Error("Job failed");
    } finally {
      this.runningJobs.delete(job.id);
      this.registry.delete(job.id);
      this._runCleanup(job.id);
      this._processQueue();
      this._checkIdle();
    }
  }

  private _jobSummary(job: RetryQJob<any>): JobSummary {
    return {
      id: job.id,
      label: job.label,
      state: job.state,
      retriesLeft: job.retriesLeft,
      priority: job.priority,
    };
  }
}
