## @anishhs/retryq

A tiny, dependency-free retry queue manager for handling multiple concurrent async jobs with priorities, exponential backoff, jitter, cancellation, and simple introspection.

- **Concurrency control**: limit how many jobs run at once
- **Exponential backoff** with configurable base delay, multiplier, jitter
- **Global time cap** per job via `maxTime`
- **Priority queueing**: higher priority jobs run first
- **Cancellation**: cancel pending retries and sleep waits
- **Introspection**: list jobs, find by id/label
- **TypeScript** ready with bundled types


### Installation

```bash
npm install @anishhs/retryq
```

Node.js 16+ recommended.


### Quick start

```ts
import { RetryQManager } from "@anishhs/retryq";

// Allow up to 3 jobs to run concurrently
const retryQ = new RetryQManager(3);

// Any function returning a Promise can be a job
async function flakyTask() {
  // ... do something that may fail
}

const job = retryQ.createJob(flakyTask, {
  label: "sync-user",
  priority: 10,
  retries: 5,
  delay: 500,      // ms
  backoff: 2,      // exponential factor
  jitter: 0.1,     // ±10%
  maxTime: 5000, // total time window per job (ms)
});

// Get the actual result or throw last error
job.promise
  .then((value) => console.log("completed", value))
  .catch((err) => console.error("failed", err));
```


### How it works (in short)
- Jobs are queued and sorted by `priority` (higher first).
- Up to `maxConcurrent` jobs can run simultaneously.
- Each job retries up to `retries` times with exponential backoff starting from `delay` and multiplying by `backoff`.
- A random jitter (±`jitter` fraction) is applied to each wait to avoid thundering-herd patterns.
- The total elapsed time per job is capped by `maxTime`.
- `job.promise` resolves with the function’s resolved value, or rejects with the last error.


## API

### `class RetryQManager`

#### `constructor(maxConcurrent?: number)`
- **maxConcurrent**: maximum number of jobs allowed to run at once. Default: `Infinity`.

#### `createJob(fn: () => Promise<any>, options?: RetryQJobOptions): RetryQJob`
Queues and starts a job. Returns a `RetryQJob` with a `promise` that resolves with the function’s return value or rejects after exhausting retries.

- `fn`: async function to execute (must return a Promise)
- `options`: optional behavior overrides (see below)

#### `cancelJob(id: string): void`
Cancels a job by id. If the job is sleeping between retries, the sleep is interrupted. If the job’s function is currently executing, it will not be forcibly aborted (user code should be cooperative if needed), but further retries are stopped and the job is marked `cancelled`.

#### `listJobs()`
Returns a snapshot of jobs grouped by state:
```ts
{
  pending: Array<{ id, label, state, retriesLeft, priority }>,
  running: Array<{ id, label, state, retriesLeft, priority }>,
  failed: Array<{ id, label, state, retriesLeft, priority }>,
  completed: Array<{ id, label, state, retriesLeft, priority }>,
}
```

#### `findJobById(id: string)`
Returns the `RetryQJob` if found in any state, otherwise `null`.

#### `findJobsByLabel(label: string)`
Returns an array of `RetryQJob` with the given label across any state.


### Types

```ts
export type RetryQJobOptions = {
  retries?: number;   // default 3
  delay?: number;     // initial delay in ms, default 1000
  backoff?: number;   // multiplier, default 2
  maxTime?: number;   // total allowed time in ms, default 5000
  jitter?: number;    // fraction, e.g., 0.1 = ±10%, default 0.1
  label?: string;     // human-readable tag
  priority?: number;  // higher runs sooner, default 1
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
  promise: Promise<any>; // resolves to your function’s actual value
  cancel: () => void;    // convenience wrapper for cancelJob
  fn: () => Promise<any>;
  options: RetryQJobOptions;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: any;
}
```


## Usage patterns

### Priorities and concurrency
```ts
const q = new RetryQManager(2); // two at a time

q.createJob(taskA, { label: "A", priority: 5 });
q.createJob(taskB, { label: "B", priority: 1 });
q.createJob(taskC, { label: "C", priority: 10 });

// C and A start first (highest priorities), then B.
```

### Custom backoff and jitter
```ts
q.createJob(fetchWithRetry, {
  retries: 4,
  delay: 250,
  backoff: 1.5,
  jitter: 0.2, // ±20%
  maxTime: 8000,
});
```

### Cancellation
```ts
const job = q.createJob(sendEmail, { label: "email#42" });

// later
q.cancelJob(job.id);
// or
job.cancel();
```

If the job is sleeping between retries, the sleep is aborted immediately. If it’s executing your function, it will not be forcibly interrupted—cooperative cancellation is advised for long-running tasks.

### Introspection
```ts
const { pending, running, failed, completed } = q.listJobs();

const maybe = q.findJobById("job-123");
const allEmailJobs = q.findJobsByLabel("email#42");
```


## Error handling
- When a job ultimately fails (retries exhausted or `maxTime` exceeded), its `promise` rejects with the last captured error.
- Failed and cancelled jobs are tracked in `listJobs()` for post-mortem or metrics.


## Defaults
- `retries`: 3
- `delay`: 1000 ms
- `backoff`: 2
- `maxTime`: 5000 ms
- `jitter`: 0.1 (±10%)
- `priority`: 1
- `maxConcurrent`: `Infinity` (constructor)


## Common recipes

### Retrying HTTP with fetch/axios
```ts
async function getJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Network error " + res.status);
  return res.json();
}

const q = new RetryQManager(4);
const job = q.createJob(() => getJson("https://api.example.com/data"), {
  retries: 6,
  delay: 300,
  backoff: 2,
  jitter: 0.15,
  maxTime: 5000,
});

const data = await job.promise;
```

### Queueing many tasks with labels
```ts
const q = new RetryQManager(5);

for (const userId of users) {
  q.createJob(() => syncUser(userId), {
    label: `sync-user:${userId}`,
    priority: 5,
  });
}
```


## Notes and caveats
- Cancellation does not forcibly abort your `fn` while it’s running; design long-running tasks to be cancellable if required.
- `maxTime` is a soft cap applied across the job’s lifetime. If elapsed time exceeds `maxTime`, the manager stops retrying and marks the job failed.
- The manager generates ids like `job-<timestamp>-<random>`; you can set a human-readable `label` for easier lookups.


## Development

Scripts:
```bash
# build TypeScript to dist/
npm run build

# run compiled output
npm start

# dev-run directly from src/
npm run dev
```

`tsconfig.json` emits `dist/index.js` and type declarations in `dist/index.d.ts`.


## License

ISC © Anish Shekh
