/**
 * Lifecycle state of a job managed by {@link RetryQManager}.
 *
 * ```
 * pending → running → completed
 *                  → failed
 *                  → cancelled
 * ```
 */
export type JobState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Information passed to {@link RetryQJobOptions.onRetry} and emitted with the
 * manager's `retry` event each time an attempt fails and another is scheduled.
 */
export interface RetryInfo {
  /** 1-based index of the attempt that just failed. */
  attempt: number;
  /** The error thrown by the failed attempt. */
  error: unknown;
  /** Delay in milliseconds before the next attempt runs (after jitter/caps). */
  nextDelay: number;
  /** Number of attempts still remaining after this failure. */
  retriesLeft: number;
}

/**
 * Per-job configuration accepted by {@link RetryQManager.createJob}.
 *
 * @typeParam T - Resolved value produced by the job function.
 */
export type RetryQJobOptions<T = unknown> = {
  /**
   * Number of retries **after** the initial attempt (total attempts =
   * `retries + 1`). Must be between `0` and `100`.
   * @defaultValue 3
   */
  retries?: number;
  /**
   * Initial delay between attempts, in milliseconds. Must be `>= 0`.
   * @defaultValue 1000
   */
  delay?: number;
  /**
   * Multiplier applied to the delay after each failed attempt (exponential
   * backoff). Must be `>= 1`.
   * @defaultValue 2
   */
  backoff?: number;
  /**
   * Total time budget for the job across all attempts, in milliseconds. Now
   * enforced **during** execution: an in-flight attempt is aborted once the
   * budget is exhausted. Must be `> 0`.
   * @defaultValue 30000
   */
  maxTime?: number;
  /**
   * Upper bound for a single backoff delay, in milliseconds. Prevents the
   * exponential delay from growing without limit. Must be `>= 0`.
   * @defaultValue Infinity
   */
  maxDelay?: number;
  /**
   * Maximum duration of a single attempt, in milliseconds. The attempt is
   * aborted (and counts as a failure) if it exceeds this. The effective bound
   * is `min(attemptTimeout, remaining maxTime)`. Must be `> 0` when provided.
   * @defaultValue Infinity
   */
  attemptTimeout?: number;
  /**
   * Random variation applied to each delay, as a fraction between `0` and `1`
   * (e.g. `0.1` = ±10%).
   * @defaultValue 0.1
   */
  jitter?: number;
  /**
   * Human-readable identifier used for grouping/lookup via
   * {@link RetryQManager.findJobsByLabel}. Defaults to the generated job id.
   */
  label?: string;
  /**
   * Queue priority — higher values are dispatched before lower ones.
   * @defaultValue 1
   */
  priority?: number;
  /**
   * External {@link AbortSignal}. Aborting it force-cancels the job.
   */
  signal?: AbortSignal;
  /**
   * Predicate deciding whether a thrown error should be retried. Return `false`
   * to stop immediately and mark the job `failed`. When omitted, every error is
   * retried until attempts are exhausted.
   *
   * @param error - The error thrown by the attempt.
   * @param attempt - 1-based index of the attempt that just failed.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called after each failed attempt that schedules another try. */
  onRetry?: (info: RetryInfo) => void;
  /** Called once when the job completes successfully. */
  onSuccess?: (result: T) => void;
  /** Called once when the job fails after exhausting retries (or `shouldRetry`). */
  onFailure?: (error: unknown) => void;
  /** Called once when the job is cancelled. */
  onCancel?: () => void;
};

/** Configuration for the {@link RetryQManager} itself. */
export type RetryQManagerConfig = {
  /**
   * Maximum number of jobs allowed to run concurrently.
   * @defaultValue Infinity
   */
  maxConcurrent?: number;
  /**
   * Maximum number of jobs retained per terminal-state history map
   * (completed/failed/cancelled) before the oldest are evicted (LRU).
   * @defaultValue 1000
   */
  maxHistorySize?: number;
};

/**
 * A unit of work tracked by {@link RetryQManager}.
 *
 * @typeParam T - Resolved value produced by the job function.
 */
export interface RetryQJob<T = unknown> {
  /** Unique identifier generated at creation. */
  id: string;
  /** Human-readable label (defaults to {@link RetryQJob.id}). */
  label: string;
  /** Current {@link JobState}. */
  state: JobState;
  /** Queue priority (higher runs first). */
  priority: number;
  /** Remaining attempts (initialised to `retries + 1`). */
  retriesLeft: number;
  /** Promise resolving with the job result or rejecting with the last error. */
  promise: Promise<T>;
  /**
   * Cancel this job.
   * @param force - When `true`, aborts the in-flight attempt via its signal.
   */
  cancel: (force?: boolean) => void;
  /** The async function executed (receives an {@link AbortSignal}). */
  fn: (signal?: AbortSignal) => Promise<T>;
  /** Resolved options the job was created with. */
  options: RetryQJobOptions<T>;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  /** Timestamp execution started (ms since epoch), if started. */
  startedAt?: number;
  /** Timestamp the job reached a terminal state (ms since epoch), if finished. */
  finishedAt?: number;
  /** Last error encountered, if any. */
  error?: unknown;
  /** Internal controller used to abort in-flight execution. */
  abortController?: AbortController;
}

/** Compact view of a job returned by {@link RetryQManager.listJobs}. */
export interface JobSummary {
  /** Job id. */
  id: string;
  /** Job label. */
  label: string;
  /** Current state. */
  state: JobState;
  /** Remaining attempts. */
  retriesLeft: number;
  /** Queue priority. */
  priority: number;
}

/** Snapshot of all jobs grouped by state, returned by {@link RetryQManager.listJobs}. */
export interface JobListSnapshot {
  /** Jobs queued and waiting for a slot. */
  pending: JobSummary[];
  /** Jobs currently executing. */
  running: JobSummary[];
  /** Jobs that exhausted retries (or were rejected by `shouldRetry`). */
  failed: JobSummary[];
  /** Jobs that completed successfully. */
  completed: JobSummary[];
  /** Jobs that were cancelled. */
  cancelled: JobSummary[];
}

/**
 * Internal no-op callback augmented with a {@link CancelableFunction.cancelSleep}
 * hook that interrupts the delay between retries when a job is cancelled.
 */
export interface CancelableFunction {
  (): void;
  /** Interrupts the in-progress retry delay, if any. */
  cancelSleep?: () => void;
}

/**
 * Payload emitted with the manager's `retry` event.
 */
export interface RetryEvent {
  /** The job being retried. */
  job: RetryQJob;
  /** Details of the failure and the scheduled retry. */
  info: RetryInfo;
}

/** Payload emitted with the manager's `success` event. */
export interface SuccessEvent {
  /** The job that completed. */
  job: RetryQJob;
  /** The resolved result. */
  result: unknown;
}

/** Payload emitted with the manager's `failure` event. */
export interface FailureEvent {
  /** The job that failed. */
  job: RetryQJob;
  /** The terminal error. */
  error: unknown;
}

/** Payload emitted with the manager's `cancel` event. */
export interface CancelEvent {
  /** The cancelled job. */
  job: RetryQJob;
}

/**
 * Typed event map for {@link RetryQManager}. Keys are event names; values are
 * the corresponding listener signatures.
 */
export interface RetryQEvents {
  /** Fired after a failed attempt schedules another try. */
  retry: (payload: RetryEvent) => void;
  /** Fired when a job completes successfully. */
  success: (payload: SuccessEvent) => void;
  /** Fired when a job fails terminally. */
  failure: (payload: FailureEvent) => void;
  /** Fired when a job is cancelled. */
  cancel: (payload: CancelEvent) => void;
  /** Fired when the queue transitions to fully idle (no pending/running jobs). */
  idle: () => void;
}
