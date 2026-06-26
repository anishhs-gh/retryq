import type { CancelableFunction } from "./types.js";

/** Monotonic counter mixed into ids to harden against same-millisecond collisions. */
let idCounter = 0;

/**
 * Generate a collision-resistant job id.
 *
 * Format: `job-{timestamp}-{counter}-{random1}{random2}`. The counter plus two
 * independent random segments make same-millisecond collisions practically
 * impossible even under high concurrency.
 *
 * @returns A unique job identifier.
 */
export function randomId(): string {
  const timestamp = Date.now();
  const counter = (idCounter++ % 10000).toString(36);
  const random1 = Math.random().toString(36).slice(2, 11);
  const random2 = Math.random().toString(36).slice(2, 11);
  return `job-${timestamp}-${counter}-${random1}${random2}`;
}

/**
 * Clamp a number into the inclusive range `[min, max]`.
 *
 * @param value - Value to clamp.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @returns The clamped value.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Sleep for `ms` milliseconds. If a {@link CancelableFunction} is supplied, a
 * `cancelSleep` hook is attached to it so the delay can be interrupted early
 * (used to abort the wait between retries when a job is cancelled).
 *
 * @param ms - Duration to sleep.
 * @param cancelFn - Optional handle that receives a `cancelSleep` interrupter.
 * @returns A promise that resolves after `ms`, or rejects if interrupted.
 */
export function sleep(ms: number, cancelFn?: CancelableFunction): Promise<void> {
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

/**
 * Error thrown when a single attempt exceeds its timeout (either an explicit
 * {@link RetryQJobOptions.attemptTimeout} or the remaining `maxTime` budget).
 */
export class RetryQTimeoutError extends Error {
  /** The timeout, in milliseconds, that was exceeded. */
  readonly timeoutMs: number;

  /**
   * @param timeoutMs - The timeout that was exceeded, in milliseconds.
   */
  constructor(timeoutMs: number) {
    super(`RetryQ attempt timed out after ${timeoutMs}ms`);
    this.name = "RetryQTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}
