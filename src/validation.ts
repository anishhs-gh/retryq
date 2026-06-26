import type { RetryQJobOptions } from "./types.js";

/** Default values applied to unspecified {@link RetryQJobOptions}. */
export const DEFAULT_OPTIONS = {
  retries: 3,
  delay: 1000,
  backoff: 2,
  maxTime: 30000,
  maxDelay: Infinity,
  attemptTimeout: Infinity,
  jitter: 0.1,
  priority: 1,
} as const;

/** Hard cap on retries to guard against accidental denial-of-service. */
export const MAX_RETRIES = 100;

/**
 * Fully-resolved numeric options used internally by the execution loop. Every
 * field is guaranteed present after {@link resolveOptions}.
 */
export interface ResolvedOptions {
  retries: number;
  delay: number;
  backoff: number;
  maxTime: number;
  maxDelay: number;
  attemptTimeout: number;
  jitter: number;
  priority: number;
}

/**
 * Validate and apply defaults to user-supplied job options.
 *
 * @param options - Raw options passed to {@link RetryQManager.createJob}.
 * @returns The resolved numeric options with all defaults applied.
 * @throws {Error} If any option is outside its allowed range.
 */
export function resolveOptions(options: RetryQJobOptions<any>): ResolvedOptions {
  const retries = options.retries ?? DEFAULT_OPTIONS.retries;
  const delay = options.delay ?? DEFAULT_OPTIONS.delay;
  const backoff = options.backoff ?? DEFAULT_OPTIONS.backoff;
  const maxTime = options.maxTime ?? DEFAULT_OPTIONS.maxTime;
  const maxDelay = options.maxDelay ?? DEFAULT_OPTIONS.maxDelay;
  const attemptTimeout = options.attemptTimeout ?? DEFAULT_OPTIONS.attemptTimeout;
  const jitter = options.jitter ?? DEFAULT_OPTIONS.jitter;
  const priority = options.priority ?? DEFAULT_OPTIONS.priority;

  if (retries < 0) {
    throw new Error("retries must be >= 0");
  }
  if (retries > MAX_RETRIES) {
    throw new Error(`retries cannot exceed ${MAX_RETRIES} (DoS protection)`);
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
  if (maxDelay < 0) {
    throw new Error("maxDelay must be >= 0");
  }
  if (attemptTimeout <= 0) {
    throw new Error("attemptTimeout must be > 0");
  }
  if (jitter < 0 || jitter > 1) {
    throw new Error("jitter must be between 0 and 1");
  }

  return {
    retries,
    delay,
    backoff,
    maxTime,
    maxDelay,
    attemptTimeout,
    jitter,
    priority,
  };
}
