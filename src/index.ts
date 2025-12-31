export type RetryQJobOptions = {
  retries?: number;
  delay?: number;
  backoff?: number;
  maxTime?: number;
  jitter?: number;
  label?: string;
  priority?: number;
  signal?: AbortSignal;
};

export type RetryQManagerConfig = {
  maxConcurrent?: number;
  maxHistorySize?: number;
};

export type JobState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface RetryQJob {
  id: string;
  label: string;
  state: JobState;
  priority: number;
  retriesLeft: number;
  promise: Promise<any>;
  cancel: (force?: boolean) => void;
  fn: (signal?: AbortSignal) => Promise<any>;
  options: RetryQJobOptions;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: any;
  abortController?: AbortController;
}

export interface CancelableFunction {
  (): void;
  cancelSleep?: () => void;
}

// Custom ID generator - improved collision resistance with counter + multiple random segments
let idCounter = 0;
function randomId() {
  const timestamp = Date.now();
  const counter = (idCounter++ % 10000).toString(36);
  const random1 = Math.random().toString(36).slice(2, 11);
  const random2 = Math.random().toString(36).slice(2, 11);
  return `job-${timestamp}-${counter}-${random1}${random2}`;
}

function sleep(ms: number, cancelFn?: CancelableFunction) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    if (cancelFn) {
      cancelFn.cancelSleep = () => {
        clearTimeout(timer);
        reject(new Error("RetryQ job cancelled"));
      };
    }
  });
}

export class RetryQManager {
  private pendingQueue: RetryQJob[] = [];
  private runningJobs: Map<string, RetryQJob> = new Map();
  private failedJobs: Map<string, RetryQJob> = new Map();
  private completedJobs: Map<string, RetryQJob> = new Map();
  private maxConcurrent: number;
  private maxHistorySize: number;
  private registry: Map<string, CancelableFunction> = new Map();

  constructor(config: RetryQManagerConfig | number = {}) {
    // Support legacy number parameter for backwards compatibility
    if (typeof config === "number") {
      this.maxConcurrent = config;
      this.maxHistorySize = 1000;
    } else {
      this.maxConcurrent = config.maxConcurrent ?? Infinity;
      this.maxHistorySize = config.maxHistorySize ?? 1000;
    }
  }

  // Evict oldest job from a map when it exceeds maxHistorySize
  private _evictOldest(map: Map<string, RetryQJob>) {
    if (map.size >= this.maxHistorySize) {
      const oldest = map.keys().next().value;
      if (oldest) {
        map.delete(oldest);
      }
    }
  }

  // Clear job history for a specific state or all states
  clearHistory(state?: JobState) {
    if (!state || state === "failed") {
      this.failedJobs.clear();
    }
    if (!state || state === "completed") {
      this.completedJobs.clear();
    }
  }

  createJob(fn: (signal?: AbortSignal) => Promise<any>, options: RetryQJobOptions = {}): RetryQJob {
    // Input validation to prevent DoS and invalid configurations
    const retries = options.retries ?? 3;
    const delay = options.delay ?? 1000;
    const backoff = options.backoff ?? 2;
    const maxTime = options.maxTime ?? 30000; // Increased from 5000 to 30000 (30s)
    const jitter = options.jitter ?? 0.1;
    const priority = options.priority ?? 1;

    // Validate inputs
    if (retries < 0) {
      throw new Error("retries must be >= 0");
    }
    if (retries > 100) {
      throw new Error("retries cannot exceed 100 (DoS protection)");
    }
    if (delay < 0) {
      throw new Error("delay must be >= 0");
    }
    if (backoff < 1) {
      throw new Error("backoff must be >= 1");
    }
    if (maxTime <= 0) {
      throw new Error("maxTime must be > 0");
    }
    if (jitter < 0 || jitter > 1) {
      throw new Error("jitter must be between 0 and 1");
    }

    const id = randomId();

    // Create internal AbortController for force cancellation
    const abortController = new AbortController();

    // If external signal provided, link it to internal controller
    if (options.signal) {
      const externalSignal = options.signal;
      externalSignal.addEventListener('abort', () => {
        if (!abortController.signal.aborted) {
          abortController.abort(externalSignal.reason);
        }
      });
    }

    const job: RetryQJob = {
      id,
      label: options.label || id,
      state: "pending",
      priority,
      retriesLeft: retries + 1, // +1 for initial attempt (retries is number of RETRIES, not total attempts)
      promise: Promise.resolve(), // placeholder
      cancel: (force?: boolean) => this.cancelJob(id, force),
      fn,
      options: { ...options, retries, delay, backoff, maxTime, jitter, priority },
      createdAt: Date.now(),
      abortController,
    };

    // Add to pending queue BEFORE starting execution (fixes state inconsistency)
    this.pendingQueue.push(job);
    this._sortQueue();

    // Start execution
    job.promise = this._runJob(job);

    // Add internal error handler to prevent unhandled promise rejections
    job.promise.catch(() => {
      // Errors are already handled in _runJob and stored in job.error
      // This catch prevents unhandled rejection if consumer doesn't add .catch()
    });

    this._processQueue();

    return job;
  }

  private _sortQueue() {
    this.pendingQueue.sort((a, b) => b.priority - a.priority);
  }

  private _processQueue() {
    // Synchronous to prevent race conditions with concurrent calls
    while (
      this.runningJobs.size < this.maxConcurrent &&
      this.pendingQueue.length > 0
    ) {
      const job = this.pendingQueue.shift()!;
      // job.promise already set in createJob
      this.runningJobs.set(job.id, job);
    }
  }

  private async _runJob(job: RetryQJob): Promise<any> {
    // Wait until _processQueue() has moved this job to runningJobs
    // This enforces concurrency control
    while (!this.runningJobs.has(job.id)) {
      // Check if cancelled while waiting
      if ((job.state as JobState) === "cancelled") {
        throw job.error || new Error("Job cancelled");
      }
      // Check if external/internal signal already aborted
      if (job.abortController?.signal.aborted) {
        job.state = "cancelled";
        job.error = new Error("Job cancelled via abort signal");
        throw job.error;
      }
      // Yield control to allow _processQueue() to run
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    job.state = "running";
    job.startedAt = Date.now();

    const cancelFn: CancelableFunction = () => {};
    this.registry.set(job.id, cancelFn);

    const {
      delay = 1000,
      backoff = 2,
      maxTime = 30000,
      jitter = 0.1,
    } = job.options;
    let currentDelay = delay;

    try {
      while (job.retriesLeft > 0) {
        // Check for cancellation at the start of each iteration
        if ((job.state as JobState) === "cancelled") {
          break;
        }

        // Check if abort signal was triggered
        if (job.abortController?.signal.aborted) {
          job.state = "cancelled";
          job.error = new Error("Job cancelled via abort signal");
          break;
        }

        const elapsed = Date.now() - (job.startedAt ?? Date.now());
        if (elapsed >= maxTime) break;

        try {
          // Pass abort signal to job function for force cancellation support
          const signal = job.abortController?.signal || new AbortController().signal;
          const result = await job.fn(signal);

          // Check if cancelled during execution
          if ((job.state as JobState) === "cancelled") {
            break;
          }

          job.state = "completed";
          job.finishedAt = Date.now();

          // Evict oldest if history is full, then add new job
          this._evictOldest(this.completedJobs);
          this.completedJobs.set(job.id, job);

          this.runningJobs.delete(job.id);
          this.registry.delete(job.id); // Clean up registry
          this._processQueue();
          return result; // returns actual value
        } catch (err) {
          job.retriesLeft--;
          job.error = err;

          // Check again after error in case cancelled during execution
          if ((job.state as JobState) === "cancelled") {
            break;
          }

          if (job.retriesLeft <= 0) break;

          // jitter with boundary checks
          const jitterAmount = currentDelay * jitter;
          let adjustedDelay =
            currentDelay + (Math.random() * 2 - 1) * jitterAmount;
          adjustedDelay = Math.max(0, Math.min(adjustedDelay, maxTime - elapsed));

          if (adjustedDelay > 0) await sleep(adjustedDelay, cancelFn);

          currentDelay *= backoff;
        }
      }

      // Job failed after exhausting retries or exceeding maxTime
      // Only set to failed if not already cancelled (can be set externally by cancelJob)
      const currentState: JobState = job.state as JobState;
      if (currentState !== "cancelled") {
        job.state = "failed";
        job.finishedAt = Date.now();

        // Evict oldest if history is full, then add new job
        this._evictOldest(this.failedJobs);
        this.failedJobs.set(job.id, job);
      }

      // Cleanup (safe to call even if already done by cancelJob)
      this.runningJobs.delete(job.id);
      this.registry.delete(job.id);
      this._processQueue();

      throw job.error || new Error("Job failed");
    } catch (err) {
      // Ensure cleanup happens even if there's an unexpected error
      this.runningJobs.delete(job.id);
      this.registry.delete(job.id);
      throw err;
    }
  }

  cancelJob(id: string, force: boolean = false) {
    const job =
      this.runningJobs.get(id) || this.pendingQueue.find((j) => j.id === id);
    if (!job) return;

    job.state = "cancelled";
    job.error = new Error("Job cancelled");
    job.finishedAt = Date.now();

    // Force cancellation: abort the controller to interrupt in-progress execution
    if (force && job.abortController && !job.abortController.signal.aborted) {
      job.abortController.abort(new Error("Job forcefully cancelled"));
    }

    this.runningJobs.delete(id);
    this.pendingQueue = this.pendingQueue.filter((j) => j.id !== id);

    // Evict oldest if history is full, then add cancelled job
    this._evictOldest(this.failedJobs);
    this.failedJobs.set(id, job);

    const cancelFn = this.registry.get(id);
    if (cancelFn?.cancelSleep) cancelFn.cancelSleep();

    // Clean up registry
    this.registry.delete(id);
  }

  listJobs() {
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
    };
  }

  findJobById(id: string) {
    return (
      this.runningJobs.get(id) ||
      this.pendingQueue.find((j) => j.id === id) ||
      this.failedJobs.get(id) ||
      this.completedJobs.get(id) ||
      null
    );
  }

  findJobsByLabel(label: string) {
    const all = [
      ...Array.from(this.runningJobs.values()),
      ...this.pendingQueue,
      ...Array.from(this.failedJobs.values()),
      ...Array.from(this.completedJobs.values()),
    ];
    return all.filter((j) => j.label === label);
  }

  private _jobSummary(job: RetryQJob) {
    return {
      id: job.id,
      label: job.label,
      state: job.state,
      retriesLeft: job.retriesLeft,
      priority: job.priority,
    };
  }
}
