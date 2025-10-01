export type RetryQJobOptions = {
  retries?: number;
  delay?: number; // initial delay in ms
  backoff?: number; // multiplier
  maxTime?: number; // total allowed time in ms
  jitter?: number; // fraction, e.g., 0.1 = ±10%
  label?: string;
  priority?: number;
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
  promise: Promise<any>; // always a Promise
  cancel: () => void;
  fn: () => Promise<any>;
  options: RetryQJobOptions;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: any;
}

export interface CancelableFunction {
  (): void;
  cancelSleep?: () => void;
}

// Custom ID generator using timestamp + larger random suffix
function randomId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
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
  private registry: Map<string, CancelableFunction> = new Map();

  constructor(maxConcurrent: number = Infinity) {
    this.maxConcurrent = maxConcurrent;
  }

  createJob(fn: () => Promise<any>, options: RetryQJobOptions = {}): RetryQJob {
    const id = randomId();
    const job: RetryQJob = {
      id,
      label: options.label || id,
      state: "pending",
      priority: options.priority ?? 1,
      retriesLeft: options.retries ?? 3,
      promise: Promise.resolve(), // placeholder
      cancel: () => this.cancelJob(id),
      fn,
      options,
      createdAt: Date.now(),
    };

    job.promise = this._runJob(job);

    this.pendingQueue.push(job);
    this._sortQueue();
    this._processQueue();

    return job;
  }

  private _sortQueue() {
    this.pendingQueue.sort((a, b) => b.priority - a.priority);
  }

  private async _processQueue() {
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
    job.state = "running";
    job.startedAt = Date.now();

    const cancelFn: CancelableFunction = () => {};
    this.registry.set(job.id, cancelFn);

    const {
      delay = 1000,
      backoff = 2,
      maxTime = 5000,
      jitter = 0.1,
    } = job.options;
    let currentDelay = delay;

    while (job.retriesLeft > 0) {
      const elapsed = Date.now() - (job.startedAt ?? Date.now());
      if (elapsed >= maxTime) break;

      try {
        const result = await job.fn();
        job.state = "completed";
        job.finishedAt = Date.now();
        this.completedJobs.set(job.id, job);
        this.runningJobs.delete(job.id);
        this._processQueue();
        return result; // returns actual value
      } catch (err) {
        job.retriesLeft--;
        job.error = err;

        if (job.retriesLeft <= 0) break;

        // jitter
        const jitterAmount = currentDelay * jitter;
        let adjustedDelay =
          currentDelay + (Math.random() * 2 - 1) * jitterAmount;
        adjustedDelay = Math.min(adjustedDelay, maxTime - elapsed);

        if (adjustedDelay > 0) await sleep(adjustedDelay, cancelFn);

        currentDelay *= backoff;
      }
    }

    if (!["cancelled", "failed"].includes(job.state)) job.state = "failed";
    job.finishedAt = Date.now();
    this.runningJobs.delete(job.id);
    this.failedJobs.set(job.id, job);
    this._processQueue();

    throw job.error || new Error("Job failed");
  }

  cancelJob(id: string) {
    const job =
      this.runningJobs.get(id) || this.pendingQueue.find((j) => j.id === id);
    if (!job) return;

    job.state = "cancelled";
    job.error = new Error("Job cancelled");
    job.finishedAt = Date.now();

    this.runningJobs.delete(id);
    this.pendingQueue = this.pendingQueue.filter((j) => j.id !== id);
    this.failedJobs.set(id, job);

    const cancelFn = this.registry.get(id);
    if (cancelFn?.cancelSleep) cancelFn.cancelSleep();
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
