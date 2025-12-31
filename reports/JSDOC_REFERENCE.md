# JSDoc Reference - @anishhs/retryq

**Version**: 1.1.0
**Last Updated**: 2025-12-31
**Purpose**: Complete JSDoc documentation for all types and methods

---

## 📋 Table of Contents

1. [File Locations](#file-locations)
2. [How to Regenerate JSDoc](#how-to-regenerate-jsdoc)
3. [Type Definitions](#type-definitions)
   - [RetryQJobOptions](#retryqjoboptions)
   - [RetryQManagerConfig](#retryqmanagerconfig)
   - [JobState](#jobstate)
   - [RetryQJob](#retryqjob)
   - [CancelableFunction](#cancelablefunction)
4. [RetryQManager Class](#retryqmanager-class)
   - [Constructor](#constructor)
   - [Public Methods](#public-methods)
   - [Private Methods](#private-methods)
5. [Quick Reference](#quick-reference)

---

## 📁 File Locations

### Source Files
- **TypeScript Source**: `src/index.ts`
- **Type Definitions (Generated)**: `dist/index.d.ts`
- **Compiled JavaScript**: `dist/index.js`

### JSDoc Locations
- **Type Definitions**: `dist/index.d.ts` (lines 1-650)
- **This Reference**: `reports/JSDOC_REFERENCE.md`

---

## 🔄 How to Regenerate JSDoc

### After Build
When you run `npm run build`, TypeScript generates `dist/index.d.ts`. To restore JSDoc:

**Option 1: Manual Copy** (if JSDoc is lost)
1. Open this file (`reports/JSDOC_REFERENCE.md`)
2. Copy the JSDoc for each type/method from sections below
3. Paste into `dist/index.d.ts` above corresponding declarations

**Option 2: Automated Script**
```bash
# After build, copy complete JSDoc version from backup
cp reports/index.d.ts.backup dist/index.d.ts
```

**Option 3: Add to Source** (Recommended)
Add JSDoc to `src/index.ts` so it's preserved during compilation.

### For AI/Automated Updates
This file serves as the source of truth for JSDoc. Any AI tool can:
1. Read this file for complete documentation
2. Apply JSDoc to `dist/index.d.ts` programmatically
3. Update both this file and `dist/index.d.ts` simultaneously

---

## 📘 Type Definitions

### RetryQJobOptions

**Location**: `dist/index.d.ts:1-61`

**Full JSDoc**:
```typescript
/**
 * Configuration options for individual retry jobs.
 *
 * @typedef {Object} RetryQJobOptions
 * @property {number} [retries=3] - Number of retry attempts after initial execution. Total attempts = retries + 1.
 *   - `retries: 0` means 1 total attempt (no retries)
 *   - `retries: 3` means 4 total attempts (initial + 3 retries)
 *   - Maximum allowed: 100 (DoS protection)
 *   - Default: 3
 * @property {number} [delay=1000] - Base delay in milliseconds between retry attempts.
 *   - Must be >= 0
 *   - Actual delay = delay * (backoff ^ attemptNumber) * (1 ± jitter)
 *   - Default: 1000ms (1 second)
 * @property {number} [backoff=1.5] - Exponential backoff multiplier for retry delays.
 *   - Must be >= 1
 *   - Applied as: delay * (backoff ^ attemptNumber)
 *   - Example: delay=1000, backoff=2 → 1s, 2s, 4s, 8s, ...
 *   - Default: 1.5
 * @property {number} [maxTime=30000] - Maximum execution time in milliseconds for the entire job (all attempts).
 *   - Job fails if total time exceeds this limit
 *   - Must be >= 0
 *   - Default: 30000ms (30 seconds)
 * @property {number} [jitter=0.1] - Random variation factor to prevent thundering herd.
 *   - Must be between 0 and 1 (0% to 100%)
 *   - Applied as: actualDelay = baseDelay * (1 ± jitter)
 *   - Example: jitter=0.1 means ±10% randomization
 *   - Default: 0.1 (10%)
 * @property {string} [label=""] - Human-readable label for the job (useful for filtering/debugging).
 *   - Default: "" (empty string)
 * @property {number} [priority=0] - Priority level for queue ordering.
 *   - Higher numbers = higher priority (processed first)
 *   - Jobs with equal priority use FIFO ordering
 *   - Default: 0
 * @property {AbortSignal} [signal] - External AbortSignal to link for force cancellation.
 *   - When external signal aborts, the job will be cancelled
 *   - Allows parent components to control job cancellation
 *   - Optional - if not provided, internal AbortController is used
 *
 * @example
 * ```typescript
 * const options = {
 *   retries: 5,           // 6 total attempts
 *   delay: 2000,          // Start with 2s delay
 *   backoff: 2,           // Double delay each retry
 *   maxTime: 60000,       // Fail after 1 minute total
 *   jitter: 0.2,          // ±20% randomization
 *   label: 'api-call',    // Easy to find in logs
 *   priority: 10          // High priority
 * };
 * ```
 */
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
```

**Used By**:
- `RetryQManager.createJob()` - As parameter
- `RetryQJob.options` - As property

---

### RetryQManagerConfig

**Location**: `dist/index.d.ts:63-89`

**Full JSDoc**:
```typescript
/**
 * Configuration for the RetryQManager instance.
 *
 * @typedef {Object} RetryQManagerConfig
 * @property {number} [maxConcurrent=Infinity] - Maximum number of jobs that can run concurrently.
 *   - Jobs beyond this limit wait in the pending queue
 *   - Default: Infinity (no limit, not recommended for production)
 *   - Recommended: Set based on system resources (e.g., 5-20)
 * @property {number} [maxHistorySize=1000] - Maximum number of jobs to keep in history per state.
 *   - Applies to completed and failed job lists
 *   - Uses LRU (Least Recently Used) eviction when limit reached
 *   - Prevents unbounded memory growth in long-running processes
 *   - Default: 1000
 *   - Set to lower value for memory-constrained environments
 *
 * @example
 * ```typescript
 * const config = {
 *   maxConcurrent: 10,      // Max 10 jobs running at once
 *   maxHistorySize: 500     // Keep last 500 completed/failed jobs
 * };
 * ```
 */
export type RetryQManagerConfig = {
    maxConcurrent?: number;
    maxHistorySize?: number;
};
```

**Used By**:
- `RetryQManager.constructor()` - As parameter

---

### JobState

**Location**: `dist/index.d.ts:91-108`

**Full JSDoc**:
```typescript
/**
 * Possible states for a job in its lifecycle.
 *
 * @typedef {"pending" | "running" | "completed" | "failed" | "cancelled"} JobState
 *
 * State transitions:
 * - `pending` → `running` (when execution starts)
 * - `running` → `completed` (successful execution)
 * - `running` → `failed` (exhausted retries or maxTime exceeded)
 * - `running` → `cancelled` (user called cancel())
 * - `pending` → `cancelled` (cancelled before execution)
 *
 * Terminal states (no further transitions):
 * - `completed`
 * - `failed`
 * - `cancelled`
 */
export type JobState = "pending" | "running" | "completed" | "failed" | "cancelled";
```

**Used By**:
- `RetryQJob.state` - As property type
- `RetryQManager.clearHistory()` - As parameter
- `RetryQManager.listJobs()` - In return type

---

### RetryQJob

**Location**: `dist/index.d.ts:110-181`

**Full JSDoc**:
```typescript
/**
 * Represents a retry job with its state, configuration, and control methods.
 *
 * @interface RetryQJob
 * @property {string} id - Unique identifier for the job.
 *   - Format: `job-{timestamp}-{counter}-{random1}{random2}`
 *   - Collision-resistant even with 1000+ concurrent jobs
 * @property {string} label - Human-readable label (from options.label or empty string).
 * @property {JobState} state - Current state of the job.
 *   - One of: "pending" | "running" | "completed" | "failed" | "cancelled"
 * @property {number} priority - Priority level (higher = processed first).
 * @property {number} retriesLeft - Number of retry attempts remaining.
 *   - Decrements with each failed attempt
 *   - Initial value = options.retries + 1
 * @property {Promise<any>} promise - Promise that resolves/rejects when job completes.
 *   - Resolves with job function's return value on success
 *   - Rejects with error on failure or cancellation
 *   - Safe to await or use .then()/.catch()
 * @property {(force?: boolean) => void} cancel - Cancel the job.
 *   - `cancel()` or `cancel(false)`: Cooperative cancellation (default)
 *     - Prevents future retry attempts
 *     - Interrupts sleep delays
 *     - Does NOT abort in-progress execution
 *   - `cancel(true)`: Force cancellation
 *     - Everything cooperative does, PLUS:
 *     - Aborts the internal AbortSignal
 *     - Interrupts in-progress execution (if job function checks signal)
 *   - Idempotent (safe to call multiple times)
 * @property {(signal?: AbortSignal) => Promise<any>} fn - The job function to execute.
 *   - Receives optional AbortSignal parameter for force cancellation
 *   - Should check signal?.aborted to enable force cancellation
 * @property {RetryQJobOptions} options - Configuration options used for this job.
 * @property {number} createdAt - Unix timestamp (ms) when job was created.
 * @property {number} [startedAt] - Unix timestamp (ms) when execution started (undefined if not started).
 * @property {number} [finishedAt] - Unix timestamp (ms) when job finished (undefined if not finished).
 * @property {any} [error] - Error object if job failed or was cancelled (undefined if successful).
 * @property {AbortController} [abortController] - Internal AbortController for force cancellation.
 *   - Created automatically for each job
 *   - Signal passed to job function
 *   - Aborted when cancel(true) is called
 *
 * @example
 * ```typescript
 * const job = retryQ.createJob(async (signal) => {
 *   if (signal?.aborted) throw new Error('Aborted');
 *   return await fetchData();
 * });
 *
 * console.log(job.id);          // "job-1234567890-1-abc123xyz789"
 * console.log(job.state);       // "pending"
 * console.log(job.retriesLeft); // 4 (if retries: 3)
 *
 * job.cancel(true);             // Force cancel
 * await job.promise.catch(() => console.log('Cancelled'));
 * ```
 */
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
```

**Returned By**:
- `RetryQManager.createJob()` - Returns this interface
- `RetryQManager.findJobById()` - Returns this or null
- `RetryQManager.findJobsByLabel()` - Returns array of this

---

### CancelableFunction

**Location**: `dist/index.d.ts:183-195`

**Full JSDoc**:
```typescript
/**
 * Internal function type for cancellable sleep operations.
 *
 * @interface CancelableFunction
 * @property {() => void} () - Function to call
 * @property {() => void} [cancelSleep] - Optional method to cancel pending sleep
 *
 * @internal This is used internally for retry delay cancellation
 */
export interface CancelableFunction {
    (): void;
    cancelSleep?: () => void;
}
```

**Usage**: Internal only - used by retry sleep mechanism

---

## 🏗️ RetryQManager Class

**Location**: `dist/index.d.ts:197-650`

**Class JSDoc**:
```typescript
/**
 * RetryQManager - Production-ready retry queue with concurrency control,
 * exponential backoff, and force cancellation.
 *
 * @class RetryQManager
 *
 * @description
 * A robust job queue manager for handling asynchronous operations with:
 * - Automatic retry logic with exponential backoff
 * - Configurable concurrency limits
 * - Priority-based queue ordering
 * - Force cancellation via AbortController
 * - Bounded memory usage (LRU eviction)
 * - Zero runtime dependencies
 *
 * **Features:**
 * - ✅ Concurrent execution with configurable limits
 * - ✅ Exponential backoff with jitter (prevents thundering herd)
 * - ✅ Priority queue (higher priority jobs run first)
 * - ✅ Force cancellation (AbortController/AbortSignal)
 * - ✅ Bounded history (prevents memory leaks)
 * - ✅ Input validation with DoS protection
 * - ✅ TypeScript support with full type definitions
 *
 * **Production Ready:**
 * - No memory leaks (bounded history with LRU eviction)
 * - No unhandled rejections (internal error handlers)
 * - Thread-safe concurrency control
 * - Input validation with clear error messages
 *
 * @example Basic Usage
 * ```typescript
 * import { RetryQManager } from '@anishhs/retryq';
 *
 * const retryQ = new RetryQManager({
 *   maxConcurrent: 5,
 *   maxHistorySize: 1000
 * });
 *
 * const job = retryQ.createJob(async () => {
 *   const response = await fetch('https://api.example.com/data');
 *   return response.json();
 * }, {
 *   retries: 3,
 *   delay: 1000,
 *   backoff: 2
 * });
 *
 * job.promise
 *   .then(result => console.log('Success:', result))
 *   .catch(err => console.error('Failed:', err));
 * ```
 *
 * @example Force Cancellation
 * ```typescript
 * const job = retryQ.createJob(async (signal) => {
 *   for (let i = 0; i < 100; i++) {
 *     if (signal?.aborted) throw new Error('Aborted');
 *     await processItem(i);
 *   }
 * }, { retries: 5 });
 *
 * // Later: force abort
 * job.cancel(true); // Interrupts in-progress execution
 * ```
 *
 * @example Priority Queue
 * ```typescript
 * // High priority job (runs first)
 * const urgentJob = retryQ.createJob(urgentTask, { priority: 100 });
 *
 * // Normal priority jobs
 * const normalJob1 = retryQ.createJob(task1, { priority: 10 });
 * const normalJob2 = retryQ.createJob(task2, { priority: 10 });
 * ```
 *
 * @see {@link https://github.com/anishhs/retryq-package}
 */
export declare class RetryQManager {
    // ... implementation
}
```

---

### Constructor

**Location**: `dist/index.d.ts:284-317`

**Full JSDoc**:
```typescript
/**
 * Creates a new RetryQManager instance.
 *
 * @constructor
 * @param {RetryQManagerConfig | number} [config] - Configuration object or max concurrent jobs
 *
 * @param {number} [config.maxConcurrent=Infinity] - Maximum concurrent jobs
 *   - Default: Infinity (not recommended for production)
 *   - Recommended: Set explicit limit (e.g., 5-20)
 * @param {number} [config.maxHistorySize=1000] - Maximum jobs in history per state
 *   - Default: 1000
 *   - Uses LRU eviction when exceeded
 *
 * @throws {Error} If config contains invalid values
 *
 * @example Using config object (recommended)
 * ```typescript
 * const retryQ = new RetryQManager({
 *   maxConcurrent: 10,
 *   maxHistorySize: 500
 * });
 * ```
 *
 * @example Using number (backwards compatible)
 * ```typescript
 * const retryQ = new RetryQManager(5); // maxConcurrent = 5
 * ```
 *
 * @example Default configuration
 * ```typescript
 * const retryQ = new RetryQManager(); // No limits
 * ```
 */
constructor(config?: RetryQManagerConfig | number);
```

**Parameters**:
- `config`: Optional configuration (object or number)

**Reference**: `src/index.ts:48-60`

---

### Public Methods

#### clearHistory()

**Location**: `dist/index.d.ts:326-360`

**Full JSDoc**:
```typescript
/**
 * Clear job history for specified state(s).
 * Useful for manual memory management in long-running processes.
 *
 * @method clearHistory
 * @param {JobState} [state] - Specific state to clear, or undefined to clear all terminal states
 *   - `"completed"`: Clear only completed jobs
 *   - `"failed"`: Clear only failed jobs (includes cancelled)
 *   - `undefined`: Clear both completed and failed
 *
 * @returns {void}
 *
 * @example Clear all history
 * ```typescript
 * retryQ.clearHistory(); // Clears completed + failed
 * ```
 *
 * @example Clear only completed jobs
 * ```typescript
 * retryQ.clearHistory('completed');
 * ```
 *
 * @example Clear only failed jobs
 * ```typescript
 * retryQ.clearHistory('failed');
 * ```
 *
 * @example Periodic cleanup
 * ```typescript
 * setInterval(() => {
 *   retryQ.clearHistory('completed');
 * }, 3600000); // Clear every hour
 * ```
 */
clearHistory(state?: JobState): void;
```

**Reference**: `src/index.ts:73-82`

---

#### createJob()

**Location**: `dist/index.d.ts:362-440`

**Full JSDoc**:
```typescript
/**
 * Create a new retry job and add it to the queue.
 *
 * @method createJob
 * @template T - Return type of the job function
 * @param {(signal?: AbortSignal) => Promise<T>} fn - Async function to execute with retries
 *   - Receives optional AbortSignal for force cancellation
 *   - Should check signal?.aborted to enable force abort
 *   - Can be any async operation (API call, file I/O, computation)
 * @param {RetryQJobOptions} [options={}] - Job configuration options
 *
 * @returns {RetryQJob} The created job object
 *   - Use job.promise to await result
 *   - Use job.cancel() for cooperative cancellation
 *   - Use job.cancel(true) for force cancellation
 *   - Check job.state for current status
 *
 * @throws {Error} If options contain invalid values:
 *   - retries < 0 or > 100
 *   - delay < 0
 *   - backoff < 1
 *   - jitter < 0 or > 1
 *
 * @example Basic usage
 * ```typescript
 * const job = retryQ.createJob(async () => {
 *   const response = await fetch('/api/data');
 *   return response.json();
 * });
 *
 * const result = await job.promise;
 * ```
 *
 * @example With retry configuration
 * ```typescript
 * const job = retryQ.createJob(async () => {
 *   return await unreliableOperation();
 * }, {
 *   retries: 5,        // 6 total attempts
 *   delay: 2000,       // 2s initial delay
 *   backoff: 2,        // Double each retry
 *   maxTime: 60000,    // 1 minute timeout
 *   jitter: 0.2,       // ±20% randomization
 *   priority: 10,      // Higher priority
 *   label: 'api-call'  // For filtering
 * });
 * ```
 *
 * @example Force cancellation with signal
 * ```typescript
 * const job = retryQ.createJob(async (signal) => {
 *   for (let i = 0; i < 1000; i++) {
 *     if (signal?.aborted) {
 *       throw new Error('Aborted');
 *     }
 *     await processItem(i);
 *   }
 * }, { retries: 3 });
 *
 * // Force cancel after 2 seconds
 * setTimeout(() => job.cancel(true), 2000);
 * ```
 *
 * @example External AbortController
 * ```typescript
 * const controller = new AbortController();
 *
 * const job = retryQ.createJob(async (signal) => {
 *   const res = await fetch('/api', { signal });
 *   return res.json();
 * }, {
 *   signal: controller.signal
 * });
 *
 * // Cancel from external controller
 * controller.abort();
 * ```
 */
createJob(fn: (signal?: AbortSignal) => Promise<any>, options?: RetryQJobOptions): RetryQJob;
```

**Reference**: `src/index.ts:84-166`

---

#### cancelJob()

**Location**: `dist/index.d.ts:463-505`

**Full JSDoc**:
```typescript
/**
 * Cancel a running or pending job by its ID.
 *
 * @method cancelJob
 * @param {string} id - Unique job ID (from job.id)
 * @param {boolean} [force=false] - Whether to force abort via AbortSignal
 *   - `false` (default): Cooperative cancellation
 *     - Prevents future retry attempts
 *     - Interrupts sleep delays
 *     - Does NOT abort in-progress execution
 *   - `true`: Force cancellation
 *     - Everything cooperative does, PLUS:
 *     - Aborts the AbortSignal passed to job function
 *     - Interrupts in-progress execution (if job checks signal)
 *
 * @returns {void}
 *
 * @example Cooperative cancellation (default)
 * ```typescript
 * const job = retryQ.createJob(longTask);
 * job.cancel(); // or cancelJob(job.id)
 * // Current execution completes, but no retries
 * ```
 *
 * @example Force cancellation
 * ```typescript
 * const job = retryQ.createJob(async (signal) => {
 *   if (signal?.aborted) throw new Error('Aborted');
 *   await longTask();
 * });
 *
 * job.cancel(true); // or cancelJob(job.id, true)
 * // Aborts immediately (if job checks signal)
 * ```
 *
 * @example Cancel by ID
 * ```typescript
 * retryQ.cancelJob('job-123456789-1-abc', true);
 * ```
 *
 * @see {@link RetryQJob.cancel} - Preferred way to cancel (via job object)
 */
cancelJob(id: string, force?: boolean): void;
```

**Reference**: `src/index.ts:225-242`

---

#### listJobs()

**Location**: `dist/index.d.ts:507-577`

**Full JSDoc**:
```typescript
/**
 * List all jobs grouped by their current state.
 * Returns summary information (not full job objects).
 *
 * @method listJobs
 * @returns {Object} Object containing job lists by state
 * @returns {Array} returns.pending - Jobs waiting to execute
 * @returns {Array} returns.running - Jobs currently executing
 * @returns {Array} returns.failed - Failed or cancelled jobs
 * @returns {Array} returns.completed - Successfully completed jobs
 *
 * Each job summary contains:
 * - id: string
 * - label: string
 * - state: JobState
 * - retriesLeft: number
 * - priority: number
 *
 * @example View all job states
 * ```typescript
 * const state = retryQ.listJobs();
 *
 * console.log('Pending:', state.pending.length);
 * console.log('Running:', state.running.length);
 * console.log('Failed:', state.failed.length);
 * console.log('Completed:', state.completed.length);
 * ```
 *
 * @example Monitor queue depth
 * ```typescript
 * const { pending, running } = retryQ.listJobs();
 * console.log(`Queue depth: ${pending.length} pending, ${running.length} running`);
 * ```
 *
 * @example Find cancelled jobs
 * ```typescript
 * const { failed } = retryQ.listJobs();
 * const cancelled = failed.filter(j => j.state === 'cancelled');
 * console.log('Cancelled jobs:', cancelled.length);
 * ```
 */
listJobs(): { ... };
```

**Reference**: `src/index.ts:244-252`

---

#### findJobById()

**Location**: `dist/index.d.ts:579-606`

**Full JSDoc**:
```typescript
/**
 * Find a specific job by its unique ID.
 * Searches across all job states.
 *
 * @method findJobById
 * @param {string} id - Unique job ID to search for
 *
 * @returns {RetryQJob | null} The job object if found, null otherwise
 *
 * @example Find and inspect a job
 * ```typescript
 * const job = retryQ.findJobById('job-123456789-1-abc');
 * if (job) {
 *   console.log('State:', job.state);
 *   console.log('Retries left:', job.retriesLeft);
 *   console.log('Error:', job.error);
 * }
 * ```
 *
 * @example Cancel a job by ID
 * ```typescript
 * const job = retryQ.findJobById(jobId);
 * if (job && job.state === 'running') {
 *   job.cancel(true);
 * }
 * ```
 */
findJobById(id: string): RetryQJob | null;
```

**Reference**: `src/index.ts:260-270`

---

#### findJobsByLabel()

**Location**: `dist/index.d.ts:608-642`

**Full JSDoc**:
```typescript
/**
 * Find all jobs with a specific label.
 * Useful for grouping related jobs or batch operations.
 *
 * @method findJobsByLabel
 * @param {string} label - Label to search for (exact match)
 *
 * @returns {RetryQJob[]} Array of matching jobs (empty if none found)
 *
 * @example Find jobs by label
 * ```typescript
 * const apiJobs = retryQ.findJobsByLabel('api-call');
 * console.log(`Found ${apiJobs.length} API call jobs`);
 * ```
 *
 * @example Cancel all jobs with a label
 * ```typescript
 * const jobs = retryQ.findJobsByLabel('batch-process');
 * jobs.forEach(job => {
 *   if (job.state === 'pending' || job.state === 'running') {
 *     job.cancel(true);
 *   }
 * });
 * ```
 *
 * @example Monitor specific job type
 * ```typescript
 * const uploadJobs = retryQ.findJobsByLabel('file-upload');
 * const active = uploadJobs.filter(j =>
 *   j.state === 'pending' || j.state === 'running'
 * );
 * console.log(`${active.length} uploads in progress`);
 * ```
 */
findJobsByLabel(label: string): RetryQJob[];
```

**Reference**: `src/index.ts:272-280`

---

### Private Methods

These methods are internal implementation details and not part of the public API.

#### _evictOldest()

**Location**: `dist/index.d.ts:319-324`

**JSDoc**:
```typescript
/**
 * @private
 * Internal method to evict oldest jobs from history when limit is reached.
 * Uses LRU (Least Recently Used) eviction strategy.
 */
private _evictOldest;
```

**Reference**: `src/index.ts:62-71`

---

#### _sortQueue()

**Location**: `dist/index.d.ts:442-447`

**JSDoc**:
```typescript
/**
 * @private
 * Internal method to sort pending queue by priority (descending).
 * Higher priority jobs are moved to the front.
 */
private _sortQueue;
```

**Reference**: `src/index.ts:168-173`

---

#### _processQueue()

**Location**: `dist/index.d.ts:449-454`

**JSDoc**:
```typescript
/**
 * @private
 * Internal method to process the pending queue and start jobs.
 * Enforces maxConcurrent limit.
 */
private _processQueue;
```

**Reference**: `src/index.ts:175-186`

---

#### _runJob()

**Location**: `dist/index.d.ts:456-461`

**JSDoc**:
```typescript
/**
 * @private
 * Internal method to execute a single job with retry logic.
 * Handles exponential backoff, jitter, and state management.
 */
private _runJob;
```

**Reference**: `src/index.ts:188-223`

---

#### _jobSummary()

**Location**: `dist/index.d.ts:644-649`

**JSDoc**:
```typescript
/**
 * @private
 * Internal method to create job summary objects for listJobs().
 * Extracts only essential fields for performance.
 */
private _jobSummary;
```

**Reference**: `src/index.ts:254-258`

---

## 📚 Quick Reference

### All Public Types

| Type | Description | Location |
|------|-------------|----------|
| `RetryQJobOptions` | Job configuration options | `dist/index.d.ts:1-61` |
| `RetryQManagerConfig` | Manager configuration | `dist/index.d.ts:63-89` |
| `JobState` | Job lifecycle states | `dist/index.d.ts:91-108` |
| `RetryQJob` | Job interface with methods | `dist/index.d.ts:110-181` |
| `CancelableFunction` | Internal sleep cancellation | `dist/index.d.ts:183-195` |

### All Public Methods

| Method | Purpose | Parameters | Returns |
|--------|---------|------------|---------|
| `constructor()` | Create manager instance | `config?: RetryQManagerConfig \| number` | `RetryQManager` |
| `clearHistory()` | Clear job history | `state?: JobState` | `void` |
| `createJob()` | Create retry job | `fn, options?` | `RetryQJob` |
| `cancelJob()` | Cancel job by ID | `id: string, force?: boolean` | `void` |
| `listJobs()` | List all jobs | None | `{ pending, running, failed, completed }` |
| `findJobById()` | Find job by ID | `id: string` | `RetryQJob \| null` |
| `findJobsByLabel()` | Find jobs by label | `label: string` | `RetryQJob[]` |

### All Private Methods

| Method | Purpose | Location |
|--------|---------|----------|
| `_evictOldest()` | LRU eviction of history | `src/index.ts:62-71` |
| `_sortQueue()` | Sort by priority | `src/index.ts:168-173` |
| `_processQueue()` | Start pending jobs | `src/index.ts:175-186` |
| `_runJob()` | Execute with retries | `src/index.ts:188-223` |
| `_jobSummary()` | Create job summaries | `src/index.ts:254-258` |

---

## 🔧 Maintenance Instructions

### When Adding New Features

1. **Update Source**:
   - Add feature to `src/index.ts`
   - Add JSDoc to new types/methods

2. **Build**:
   - Run `npm run build`
   - TypeScript generates `dist/index.d.ts`

3. **Update This Document**:
   - Add new JSDoc to appropriate section
   - Update Quick Reference tables
   - Update version number at top

4. **Apply JSDoc to dist/**:
   - Copy JSDoc from this file
   - Paste into `dist/index.d.ts`
   - Or use automated script (if available)

### When Regenerating After Build

If `dist/index.d.ts` loses JSDoc after build:

```bash
# Option 1: Manual copy from this file
# Option 2: Restore from backup (if exists)
cp reports/index.d.ts.backup dist/index.d.ts

# Option 3: Add JSDoc to src/index.ts (permanent solution)
```

### For AI Tools

This file is structured for easy parsing:
- Each section has clear headers with anchors
- JSDoc blocks are complete and copy-pasteable
- File locations are provided for all references
- Quick reference tables for automation

---

## 📝 Notes

- **Version Control**: This file should be version controlled alongside the codebase
- **Build Process**: Consider adding JSDoc to `src/index.ts` so it's preserved during compilation
- **Automation**: A build script could automatically apply JSDoc from this file to `dist/index.d.ts`
- **IDE Support**: Most IDEs read JSDoc from `.d.ts` files for intellisense

---

**Last Updated**: 2025-12-31
**Maintained By**: Anish Shekh
**Package Version**: 1.1.0
