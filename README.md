# @anishhs/retryq

A production-ready, zero-dependency retry queue manager for Node.js with support for concurrent job execution, priorities, exponential backoff, jitter, and **force cancellation**.

[![npm version](https://img.shields.io/npm/v/@anishhs/retryq.svg)](https://www.npmjs.com/package/@anishhs/retryq)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-green.svg)](https://opensource.org/licenses/ISC)

## Features

- ✅ **Concurrency control** - Limit concurrent job execution
- ✅ **Priority queue** - Higher priority jobs execute first
- ✅ **Exponential backoff** with configurable delay, multiplier, `maxDelay`, and jitter
- ✅ **Lifecycle events & hooks** - `retry`/`success`/`failure`/`cancel`/`idle` events + per-job callbacks
- ✅ **Conditional retries** - `shouldRetry(error, attempt)` predicate to skip non-retryable errors
- ✅ **Force cancellation** - Abort in-progress jobs with AbortController
- ✅ **Cooperative cancellation** - Graceful job termination
- ✅ **Real time limits** - `maxTime` (and `attemptTimeout`) actively abort in-flight attempts
- ✅ **Queue draining** - `onIdle()` / `drain()` to await all work
- ✅ **Memory safe** - Bounded job history with LRU eviction
- ✅ **Job introspection** - List, find, and track jobs by ID or label
- ✅ **TypeScript** - Generic, fully-typed API with bundled declarations
- ✅ **Dual ESM + CJS** - Ships both module formats with an `exports` map
- ✅ **Zero dependencies** - Minimal footprint, no external packages

## Installation

```bash
npm install @anishhs/retryq
```

**Requirements**: Node.js 16+

## Quick Start

```typescript
import { RetryQManager } from '@anishhs/retryq';

// Create manager with 3 concurrent jobs max
const retryQ = new RetryQManager({ maxConcurrent: 3 });

// Create a job with retry logic
const job = retryQ.createJob(async (signal) => {
  // Your async operation here
  const response = await fetch('https://api.example.com/data', { signal });
  return response.json();
}, {
  retries: 5,          // Retry up to 5 times
  delay: 1000,         // Initial delay 1s
  backoff: 2,          // Double delay each retry
  jitter: 0.1,         // ±10% randomization
  maxTime: 30000,      // Total timeout 30s
  priority: 10,        // Higher priority = runs sooner
  label: 'fetch-data'  // Human-readable identifier
});

// Wait for result
job.promise
  .then(data => console.log('Success:', data))
  .catch(err => console.error('Failed:', err));

// Cancel if needed
job.cancel(true); // Force abort in-progress execution
```

## Table of Contents

- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
- [Cancellation Modes](#cancellation-modes)
- [Usage Examples](#usage-examples)
- [Configuration Options](#configuration-options)
- [Best Practices](#best-practices)
- [Migration Guide](#migration-guide)
- [Changelog](#changelog)

---

## Core Concepts

### Job Lifecycle

```
pending → running → completed
                 → failed
                 → cancelled
```

1. **Pending**: Job queued, waiting for available slot
2. **Running**: Job executing with retries
3. **Completed**: Job succeeded
4. **Failed**: Job exhausted all retries
5. **Cancelled**: Job cancelled by user

### Retry Logic

```
Attempt 1: Execute immediately
  ↓ (fails)
Attempt 2: Wait delay * backoff^0 = 1000ms
  ↓ (fails)
Attempt 3: Wait delay * backoff^1 = 2000ms
  ↓ (fails)
Attempt 4: Wait delay * backoff^2 = 4000ms
  ...
```

Each delay includes jitter: `delay ± (delay * jitter)`

### Priority Queue

Jobs with higher `priority` values execute first:

```typescript
retryQ.createJob(taskA, { priority: 1 });  // Runs last
retryQ.createJob(taskB, { priority: 5 });  // Runs second
retryQ.createJob(taskC, { priority: 10 }); // Runs first
```

---

## API Reference

### RetryQManager

#### Constructor

```typescript
new RetryQManager(config?: RetryQManagerConfig | number)
```

**Parameters**:
- `config.maxConcurrent` - Maximum concurrent jobs (default: `Infinity`)
- `config.maxHistorySize` - Maximum jobs in history (default: `1000`)

**Legacy**: Accepts number for `maxConcurrent` (backwards compatible)

```typescript
// New style (recommended)
const retryQ = new RetryQManager({
  maxConcurrent: 5,
  maxHistorySize: 1000
});

// Old style (still works)
const retryQ = new RetryQManager(5);
```

---

#### createJob()

```typescript
createJob(
  fn: (signal?: AbortSignal) => Promise<any>,
  options?: RetryQJobOptions
): RetryQJob
```

**Parameters**:
- `fn` - Async function to execute
  - `signal` - Optional AbortSignal for force cancellation
- `options` - Job configuration (see [Configuration](#configuration-options))

**Returns**: `RetryQJob` object

```typescript
const job = retryQ.createJob(async (signal) => {
  // Check signal to support force cancellation
  if (signal?.aborted) throw new Error('Aborted');

  return await doWork();
}, {
  retries: 3,
  delay: 1000,
  label: 'my-job'
});
```

---

#### cancelJob()

```typescript
cancelJob(id: string, force?: boolean): void
```

**Parameters**:
- `id` - Job ID to cancel
- `force` - Enable force cancellation (default: `false`)

```typescript
// Cooperative cancellation (default)
retryQ.cancelJob(job.id);

// Force cancellation (aborts via AbortSignal)
retryQ.cancelJob(job.id, true);
```

---

#### listJobs()

```typescript
listJobs(): {
  pending: JobSummary[];
  running: JobSummary[];
  failed: JobSummary[];
  completed: JobSummary[];
}
```

**Returns**: Snapshot of all jobs grouped by state

```typescript
const { pending, running, failed, completed } = retryQ.listJobs();
console.log(`${running.length} jobs currently executing`);
```

---

#### findJobById()

```typescript
findJobById(id: string): RetryQJob | null
```

**Returns**: Job if found, otherwise `null`

```typescript
const job = retryQ.findJobById('job-123');
if (job) {
  console.log('Job state:', job.state);
}
```

---

#### findJobsByLabel()

```typescript
findJobsByLabel(label: string): RetryQJob[]
```

**Returns**: Array of jobs with matching label

```typescript
const emailJobs = retryQ.findJobsByLabel('send-email');
console.log(`${emailJobs.length} email jobs found`);
```

---

#### clearHistory()

```typescript
clearHistory(state?: JobState): void
```

**Parameters**:
- `state` - Optional state to clear (`'failed'` or `'completed'`)
- Omit to clear both

```typescript
// Clear completed jobs only
retryQ.clearHistory('completed');

// Clear all history
retryQ.clearHistory();
```

---

#### onIdle() / drain()

```typescript
onIdle(): Promise<void>
drain(): Promise<void>   // alias
```

Resolves when the queue is fully idle (no pending **and** no running jobs).
Resolves immediately if already idle.

```typescript
for (const item of items) {
  retryQ.createJob(() => process(item), { retries: 3 });
}
await retryQ.onIdle(); // wait for the whole batch to settle
```

---

### Events

`RetryQManager` extends Node's `EventEmitter` and emits typed events:

```typescript
retryQ.on('retry',   ({ job, info })   => console.log(`retry #${info.attempt} in ${info.nextDelay}ms`));
retryQ.on('success', ({ job, result }) => console.log('done', job.label));
retryQ.on('failure', ({ job, error })  => console.error('failed', job.label, error));
retryQ.on('cancel',  ({ job })         => console.log('cancelled', job.label));
retryQ.on('idle',    ()                => console.log('queue drained'));
```

| Event | Payload | Fired when |
|-------|---------|-----------|
| `retry` | `{ job, info: RetryInfo }` | A failed attempt schedules another try |
| `success` | `{ job, result }` | A job completes successfully |
| `failure` | `{ job, error }` | A job fails terminally |
| `cancel` | `{ job }` | A job is cancelled |
| `idle` | _(none)_ | The queue transitions to fully idle |

Prefer per-job feedback? Use the `onRetry` / `onSuccess` / `onFailure` /
`onCancel` callbacks in `RetryQJobOptions`.

---

### Conditional Retries

Skip retries for errors that will never succeed:

```typescript
retryQ.createJob(async (signal) => {
  const res = await fetch(url, { signal });
  if (!res.ok) throw Object.assign(new Error('HTTP'), { status: res.status });
  return res.json();
}, {
  retries: 5,
  // Retry 5xx and network errors; give up on 4xx immediately.
  shouldRetry: (err) => !(err?.status >= 400 && err?.status < 500),
});
```

---

### RetryQJob Interface

```typescript
interface RetryQJob {
  id: string;                           // Unique identifier
  label: string;                        // Human-readable name
  state: JobState;                      // Current state
  priority: number;                     // Execution priority
  retriesLeft: number;                  // Remaining attempts
  promise: Promise<any>;                // Result promise
  cancel: (force?: boolean) => void;    // Cancel method
  fn: (signal?: AbortSignal) => Promise<any>;
  options: RetryQJobOptions;            // Configuration
  createdAt: number;                    // Timestamp (ms)
  startedAt?: number;                   // Execution start (ms)
  finishedAt?: number;                  // Completion time (ms)
  error?: any;                          // Last error
  abortController?: AbortController;    // Internal controller
}
```

---

## Cancellation Modes

### 1. Cooperative Cancellation (Default)

**Usage**: `job.cancel()` or `job.cancel(false)`

**Behavior**:
- ✅ Prevents future retries
- ✅ Interrupts sleep between retries
- ❌ Does NOT abort in-progress execution

**When to use**:
- Operations should complete cleanly
- Legacy code without signal support
- Database transactions

```typescript
const job = retryQ.createJob(async () => {
  await database.transaction();
  return 'done';
});

job.cancel(); // Waits for transaction to complete
```

---

### 2. Force Cancellation ⭐ NEW!

**Usage**: `job.cancel(true)`

**Behavior**:
- ✅ Prevents future retries
- ✅ Interrupts sleep between retries
- ✅ **Aborts in-progress execution via AbortSignal**

**When to use**:
- HTTP requests (fetch, axios)
- Long-running computations
- File uploads/downloads
- Polling operations

```typescript
const job = retryQ.createJob(async (signal) => {
  // Check signal to enable force abort
  for (let i = 0; i < 1000; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    await processItem(i);
  }
});

job.cancel(true); // Immediately aborts execution
```

---

### External AbortController

Link your own `AbortController` to the job:

```typescript
const controller = new AbortController();

const job = retryQ.createJob(async (signal) => {
  return await longOperation(signal);
}, {
  signal: controller.signal  // Link external signal
});

// Cancel via external controller
controller.abort();

// Or via job method
job.cancel(true);
```

---

## Usage Examples

### Example 1: HTTP Requests with Retries

```typescript
async function fetchWithRetry(url: string) {
  const retryQ = new RetryQManager({ maxConcurrent: 5 });

  const job = retryQ.createJob(async (signal) => {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  }, {
    retries: 5,
    delay: 1000,
    backoff: 2,
    jitter: 0.15,
    maxTime: 30000,
    label: 'fetch-api'
  });

  return job.promise;
}

// Use it
const data = await fetchWithRetry('https://api.example.com/data');
```

---

### Example 2: Batch Processing with Priority

```typescript
const retryQ = new RetryQManager({ maxConcurrent: 3 });

const users = ['user1', 'user2', 'user3'];

for (const userId of users) {
  retryQ.createJob(async (signal) => {
    if (signal?.aborted) throw new Error('Aborted');
    return await syncUser(userId);
  }, {
    label: `sync-${userId}`,
    priority: userId === 'admin' ? 10 : 5, // Admin first
    retries: 3
  });
}
```

---

### Example 3: File Upload with Progress Tracking

```typescript
const uploadJob = retryQ.createJob(async (signal) => {
  const formData = new FormData();
  formData.append('file', fileBlob);

  const response = await fetch('/upload', {
    method: 'POST',
    body: formData,
    signal // Abort upload on cancel
  });

  return response.json();
}, {
  retries: 3,
  delay: 2000,
  label: 'file-upload'
});

// User clicks cancel button
cancelButton.onclick = () => uploadJob.cancel(true);

// Track progress
uploadJob.promise
  .then(result => console.log('Upload complete:', result))
  .catch(err => console.log('Upload failed:', err.message));
```

---

### Example 4: Polling with Auto-Stop

```typescript
const pollJob = retryQ.createJob(async (signal) => {
  while (true) {
    if (signal?.aborted) throw new Error('Polling stopped');

    const status = await checkJobStatus(signal);

    if (status === 'completed') {
      return status;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}, {
  retries: 100,
  delay: 5000,
  maxTime: 300000, // 5 minutes total
  label: 'poll-job-status'
});

// Stop polling
setTimeout(() => pollJob.cancel(true), 60000);
```

---

### Example 5: Graceful Shutdown

```typescript
const jobs: RetryQJob[] = [];

// Queue multiple jobs
for (let i = 0; i < 100; i++) {
  const job = retryQ.createJob(async (signal) => {
    return await processItem(i, signal);
  }, { retries: 3 });

  jobs.push(job);
}

// Handle shutdown signal
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');

  // Cancel all running jobs cooperatively
  jobs.forEach(job => {
    if (job.state === 'running' || job.state === 'pending') {
      job.cancel(); // Cooperative
    }
  });

  // Wait for jobs to finish (with timeout)
  await Promise.race([
    Promise.allSettled(jobs.map(j => j.promise)),
    new Promise(resolve => setTimeout(resolve, 10000))
  ]);

  process.exit(0);
});
```

---

## Configuration Options

### RetryQJobOptions

```typescript
type RetryQJobOptions<T = unknown> = {
  retries?: number;        // Number of retry attempts (default: 3)
  delay?: number;          // Initial delay in ms (default: 1000)
  backoff?: number;        // Delay multiplier (default: 2)
  maxTime?: number;        // Total time limit in ms (default: 30000)
  maxDelay?: number;       // Cap for a single backoff delay (default: Infinity)
  attemptTimeout?: number; // Per-attempt timeout in ms (default: Infinity)
  jitter?: number;         // Jitter fraction 0-1 (default: 0.1)
  label?: string;          // Human-readable identifier (default: job ID)
  priority?: number;       // Execution priority (default: 1)
  signal?: AbortSignal;    // External abort signal (optional)

  // Conditional retry: return false to stop retrying immediately
  shouldRetry?: (error: unknown, attempt: number) => boolean;

  // Per-job lifecycle callbacks
  onRetry?: (info: RetryInfo) => void;
  onSuccess?: (result: T) => void;
  onFailure?: (error: unknown) => void;
  onCancel?: () => void;
};
```

### Default Values

| Option | Default | Description |
|--------|---------|-------------|
| `retries` | `3` | Number of retry attempts after initial try |
| `delay` | `1000` | Initial delay between retries (ms) |
| `backoff` | `2` | Multiplier for exponential backoff |
| `maxTime` | `30000` | Total execution time limit (30s), enforced during attempts |
| `maxDelay` | `Infinity` | Cap for a single backoff delay (ms) |
| `attemptTimeout` | `Infinity` | Per-attempt timeout (ms) |
| `jitter` | `0.1` | Random delay variation (±10%) |
| `priority` | `1` | Queue priority (higher = sooner) |
| `maxConcurrent` | `Infinity` | Concurrent job limit |
| `maxHistorySize` | `1000` | Jobs kept in history per state |

### Validation Rules

```typescript
// retries: 0 to 100
if (retries < 0) throw new Error('retries must be >= 0');
if (retries > 100) throw new Error('retries cannot exceed 100 (DoS protection)');

// delay: >= 0
if (delay < 0) throw new Error('delay must be >= 0');

// backoff: >= 1
if (backoff < 1) throw new Error('backoff must be >= 1');

// maxTime: > 0
if (maxTime <= 0) throw new Error('maxTime must be > 0');

// jitter: 0 to 1
if (jitter < 0 || jitter > 1) throw new Error('jitter must be between 0 and 1');
```

---

## Best Practices

### ✅ DO

**1. Use AbortSignal for force cancellation**
```typescript
async (signal) => {
  if (signal?.aborted) throw new Error('Aborted');
  await work();
}
```

**2. Set appropriate maxTime**
```typescript
// Long operations need higher limits
retryQ.createJob(fn, { maxTime: 60000 }); // 1 minute
```

**3. Use labels for tracking**
```typescript
retryQ.createJob(fn, { label: 'user-sync:123' });
```

**4. Clean up history periodically**
```typescript
setInterval(() => retryQ.clearHistory('completed'), 3600000); // Hourly
```

**5. Monitor queue depth**
```typescript
const { pending, running } = retryQ.listJobs();
console.log(`Queue: ${pending.length} pending, ${running.length} running`);
```

---

### ❌ DON'T

**1. Don't ignore signal parameter**
```typescript
// BAD - force cancel won't work
async () => await work();

// GOOD - supports force cancel
async (signal) => {
  if (signal?.aborted) throw new Error('Aborted');
  await work();
}
```

**2. Don't use infinite retries**
```typescript
// BAD - will retry forever
{ retries: Infinity }

// GOOD - capped at 100
{ retries: 10 }
```

**3. Don't leak secrets in errors**
```typescript
// BAD - error might contain API key
throw new Error(`Failed with key: ${apiKey}`);

// GOOD - sanitized error
throw new Error('API request failed');
```

---

## Migration Guide

### From v1.1.x to v1.2.x

**No breaking API changes.** All existing code keeps working; new options,
callbacks, events, and methods are additive. Two behavior fixes to be aware of:

- `listJobs().cancelled` now holds cancelled jobs — they no longer appear under
  `failed`.
- `maxTime` now actively aborts an in-flight attempt once the budget is
  exhausted (previously it only blocked starting a new attempt).

The package now ships **both ESM and CJS** with an `exports` map; `import` and
`require` both resolve automatically.

### From v1.0.x to v1.1.x

**No breaking changes!** All existing code works.

**To add force cancellation**:

```typescript
// Before (v1.0.x)
const job = retryQ.createJob(async () => {
  await work();
});

// After (v1.1.x with force cancel)
const job = retryQ.createJob(async (signal) => {
  if (signal?.aborted) throw new Error('Aborted');
  await work();
});

job.cancel(true); // Now supports force abort!
```

---

## Performance

### Benchmarks

**Tested on**: MacBook Pro M1, 16GB RAM, Node.js 20

| Operation | Performance |
|-----------|------------|
| Create 1000 jobs | ~5ms |
| ID collision (1000 concurrent) | 0 collisions |
| Signal check (1M iterations) | ~2-3ms |
| Queue processing (100 jobs) | <1ms |
| Memory usage (10K jobs) | ~50MB |

### Memory Management

- **Bounded history**: LRU eviction at `maxHistorySize`
- **Registry cleanup**: Automatic cleanup after job completion
- **No leaks**: All references cleaned up properly

---

## TypeScript Support

Full type safety with bundled declarations:

```typescript
import {
  RetryQManager,
  RetryQJob,
  RetryQJobOptions,
  RetryQManagerConfig,
  JobState,
  CancelableFunction
} from '@anishhs/retryq';

const manager: RetryQManager = new RetryQManager({
  maxConcurrent: 5,
  maxHistorySize: 1000
});

const job: RetryQJob = manager.createJob(
  async (signal?: AbortSignal) => {
    return 'result';
  },
  {
    retries: 3,
    delay: 1000
  }
);
```

---

## Troubleshooting

### Issue: Jobs not executing

**Cause**: Exceeded `maxConcurrent` limit

**Solution**: Increase limit or wait for jobs to complete
```typescript
new RetryQManager({ maxConcurrent: 10 }); // Increase from default
```

---

### Issue: Memory growing unbounded

**Cause**: Too many jobs in history

**Solution**: Lower `maxHistorySize` or clear history
```typescript
new RetryQManager({ maxHistorySize: 500 }); // Lower limit
retryQ.clearHistory(); // Manual cleanup
```

---

### Issue: Force cancel not working

**Cause**: Job function doesn't check signal

**Solution**: Add signal checks
```typescript
async (signal) => {
  if (signal?.aborted) throw new Error('Aborted');
  // ... your code
}
```

---

## FAQ

**Q: Is this production-ready?**
A: Yes — covered by a `node:test` suite spanning concurrency, cancellation, events, timeouts, and retry semantics.

**Q: Does it work with TypeScript?**
A: Yes, full TypeScript support with bundled type definitions.

**Q: Can I use this in serverless (Lambda)?**
A: Yes, but jobs are in-memory only. They won't persist across cold starts.

**Q: Does it support distributed systems?**
A: No, it's single-process only. For distributed queues, use Redis/RabbitMQ.

**Q: What's the difference between cooperative and force cancellation?**
A: Cooperative prevents retries but allows current execution to complete. Force uses AbortSignal to interrupt in-progress execution.

**Q: Can I use this with fetch/axios?**
A: Yes! Pass the signal parameter directly to fetch() or axios.

---

## Examples Repository

More examples available at: [github.com/anishhs-gh/retryq-examples](https://github.com/anishhs-gh/retryq-examples) *(coming soon)*

---

## Development

```bash
npm install        # install dev dependencies
npm run typecheck  # tsc --noEmit
npm run build      # emit dual ESM + CJS into dist/ (with .d.ts)
npm test           # build (pretest) then run node:test suite
```

The package builds to both module formats:

- CommonJS → `dist/cjs` (`require`)
- ES modules → `dist/esm` (`import`)

resolved automatically via the `exports` map in `package.json`.

## CI / Release

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| **Test** | push/PR to `develop`/`master` | Typecheck, build, and test on Node 16/18/20 |
| **Audit** | push/PR + weekly | `npm audit` of production dependencies |
| **Dry-run publish** | push to `develop`, PRs | Gated on Test + Audit; verifies the npm token authenticates and has publish permission, and that `npm publish` would succeed — without publishing |
| **Publish (manual)** | `workflow_dispatch` | Gated on Test + Audit; publishes to npm and creates a GitHub Release + version tag |

Releases are **manual**: bump the version in `package.json`, merge to `master`,
then run the **Publish** workflow from the Actions tab. Requires an `NPM_TOKEN`
repository secret with publish access to the `@anishhs` scope.

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch (off `develop`)
3. Add tests for new features (`tests/*.test.js`, `node:test`)
4. Ensure `npm test` passes
5. Submit a pull request into `develop`

---

## License

ISC © Anish Shekh

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/anishhs-gh/retryq/issues)
- **GitHub**: [anishhs-gh](https://github.com/anishhs-gh)
- **Website**: [anishhs.com](https://anishhs.com)
- **LinkedIn**: [linkedin.com/in/anishsh](https://linkedin.com/in/anishsh)

---

**Made with ❤️ by Anish Shekh**
