/**
 * `@anishhs/retryq` — a production-ready, zero-dependency retry queue manager.
 *
 * @packageDocumentation
 */
export { RetryQManager } from "./manager.js";
export { RetryQTimeoutError } from "./utils.js";
export type {
  CancelableFunction,
  CancelEvent,
  FailureEvent,
  JobListSnapshot,
  JobState,
  JobSummary,
  RetryEvent,
  RetryInfo,
  RetryQEvents,
  RetryQJob,
  RetryQJobOptions,
  RetryQManagerConfig,
  SuccessEvent,
} from "./types.js";
