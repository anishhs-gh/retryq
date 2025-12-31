# Force Cancellation Feature Guide

## Overview

The `@anishhs/retryq` package now supports **force cancellation** using the standard `AbortController` API. This allows you to forcefully interrupt in-progress job executions, not just prevent future retries.

**Version**: 1.1.0+
**Status**: Production Ready ✅

---

## Cancellation Modes

### 1. Cooperative Cancellation (Default)

**Usage**: `job.cancel()` or `job.cancel(false)`

**Behavior**:
- ✅ Prevents future retry attempts
- ✅ Interrupts sleep delays between retries
- ✅ Preserves job state as "cancelled"
- ❌ Does NOT forcibly abort in-progress job function execution

**When to Use**:
- Job functions don't support AbortSignal
- Operations should complete cleanly (e.g., database transactions)
- Backwards compatibility with existing code

**Example**:
```typescript
const job = retryQ.createJob(async () => {
  // This will complete if already running
  await longRunningOperation();
  return 'done';
}, { retries: 5 });

job.cancel(); // Cooperative - waits for current execution
```

---

### 2. Force Cancellation (New!)

**Usage**: `job.cancel(true)`

**Behavior**:
- ✅ Prevents future retry attempts
- ✅ Interrupts sleep delays between retries
- ✅ Aborts the `AbortSignal` passed to job function
- ✅ **Forcefully interrupts in-progress execution** (if job function checks signal)

**When to Use**:
- Job functions support AbortSignal
- Need to immediately stop execution (e.g., long API calls, file uploads)
- Resource conservation is critical

**Example**:
```typescript
const job = retryQ.createJob(async (signal) => {
  // Check signal to enable force cancellation
  for (let i = 0; i < 100; i++) {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    await processItem(i);
  }
}, { retries: 5 });

job.cancel(true); // Force - aborts immediately
```

---

## API Reference

### Type Definitions

```typescript
// Job function signature (signal parameter is OPTIONAL)
type JobFunction = (signal?: AbortSignal) => Promise<any>;

// Job options with optional external signal
type RetryQJobOptions = {
  retries?: number;
  delay?: number;
  backoff?: number;
  maxTime?: number;
  jitter?: number;
  label?: string;
  priority?: number;
  signal?: AbortSignal; // NEW: Link to external AbortController
};

// Cancel method signature
job.cancel(force?: boolean): void;
```

### createJob() Signature

```typescript
retryQ.createJob(
  fn: (signal?: AbortSignal) => Promise<any>,
  options?: RetryQJobOptions
): RetryQJob;
```

**Parameters**:
- `fn`: Job function that receives an optional `AbortSignal`
- `options.signal`: Optional external `AbortSignal` to link

**Returns**: `RetryQJob` object with `cancel(force?)` method

---

## Usage Patterns

### Pattern 1: Basic Force Cancellation

```typescript
import { RetryQManager } from '@anishhs/retryq';

const retryQ = new RetryQManager({ maxConcurrent: 5 });

const job = retryQ.createJob(async (signal) => {
  // Check signal periodically in your loop
  for (let i = 0; i < 1000; i++) {
    if (signal?.aborted) {
      console.log('Operation aborted at iteration', i);
      throw new Error('Aborted');
    }

    await processItem(i);
  }
}, {
  retries: 5,
  delay: 1000
});

// Later: force cancel
job.cancel(true);
```

---

### Pattern 2: Fetch/Axios Integration

```typescript
const job = retryQ.createJob(async (signal) => {
  // Pass signal directly to fetch
  const response = await fetch('https://api.example.com/data', {
    signal // Fetch will auto-abort on signal
  });

  return response.json();
}, {
  retries: 3,
  delay: 1000,
  label: 'api-request'
});

// Cancel the HTTP request in-flight
job.cancel(true); // Aborts the fetch request
```

**Works with**:
- `fetch()` API (native)
- `axios` (v0.22.0+)
- `node-fetch` (v3+)
- Any library supporting `AbortSignal`

---

### Pattern 3: External AbortController

```typescript
// Create your own AbortController
const externalController = new AbortController();

const job = retryQ.createJob(async (signal) => {
  // signal is linked to externalController
  await longRunningOperation(signal);
}, {
  retries: 5,
  signal: externalController.signal // Link external signal
});

// Option 1: Cancel via external controller
externalController.abort();

// Option 2: Cancel via job (also aborts external controller)
job.cancel(true);
```

---

### Pattern 4: Helper Function Pattern

```typescript
const job = retryQ.createJob(async (signal) => {
  // Create a helper to check abort status
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }
  };

  throwIfAborted();
  await step1();

  throwIfAborted();
  await step2();

  throwIfAborted();
  await step3();

  return 'completed';
}, { retries: 3 });

job.cancel(true);
```

---

### Pattern 5: Event Listener Approach

```typescript
const job = retryQ.createJob(async (signal) => {
  return new Promise((resolve, reject) => {
    // Listen for abort event
    signal?.addEventListener('abort', () => {
      cleanup();
      reject(new Error('Aborted'));
    });

    // Start long operation
    startOperation()
      .then(resolve)
      .catch(reject);
  });
}, { retries: 5 });

job.cancel(true);
```

---

## Backwards Compatibility

### ✅ 100% Backwards Compatible

**Old code still works** without any changes:

```typescript
// Old style: no signal parameter
const job = retryQ.createJob(async () => {
  await doWork();
  return 'done';
}, { retries: 3 });

job.cancel(); // Works exactly as before (cooperative)
```

**New code can opt into force cancellation**:

```typescript
// New style: with signal parameter
const job = retryQ.createJob(async (signal) => {
  if (signal?.aborted) throw new Error('Aborted');
  await doWork();
  return 'done';
}, { retries: 3 });

job.cancel(true); // New feature (force)
```

---

## Best Practices

### ✅ DO

**1. Check signal at strategic points**
```typescript
async (signal) => {
  // Before expensive operations
  if (signal?.aborted) throw new Error('Aborted');
  await expensiveOperation();

  // In loops
  for (let item of items) {
    if (signal?.aborted) break;
    await process(item);
  }
}
```

**2. Pass signal to underlying libraries**
```typescript
async (signal) => {
  // Let fetch handle abortion
  const res = await fetch(url, { signal });
  return res.json();
}
```

**3. Use optional chaining for signal**
```typescript
async (signal) => {
  // Always use ?. to support old code
  if (signal?.aborted) throw new Error('Aborted');
}
```

**4. Clean up resources on abort**
```typescript
async (signal) => {
  const resource = await acquire();

  signal?.addEventListener('abort', () => {
    resource.cleanup();
  });

  return await useResource(resource);
}
```

### ❌ DON'T

**1. Don't assume signal is always provided**
```typescript
// BAD - will crash if signal undefined
if (signal.aborted) throw new Error('Aborted');

// GOOD - safe with optional chaining
if (signal?.aborted) throw new Error('Aborted');
```

**2. Don't ignore the signal parameter**
```typescript
// BAD - force cancel won't work
async () => {
  await longOperation();
}

// GOOD - can be force cancelled
async (signal) => {
  if (signal?.aborted) throw new Error('Aborted');
  await longOperation();
}
```

**3. Don't forget to propagate the signal**
```typescript
// BAD - nested operation can't be cancelled
async (signal) => {
  return helperFunction();
}

// GOOD - signal propagated
async (signal) => {
  return helperFunction(signal);
}
```

---

## Common Use Cases

### Use Case 1: File Upload with Progress

```typescript
const uploadJob = retryQ.createJob(async (signal) => {
  const formData = new FormData();
  formData.append('file', fileBlob);

  const response = await fetch('/upload', {
    method: 'POST',
    body: formData,
    signal // Abort upload on signal
  });

  return response.json();
}, {
  retries: 3,
  delay: 2000,
  label: 'file-upload'
});

// User clicks cancel button
cancelButton.onclick = () => uploadJob.cancel(true);
```

---

### Use Case 2: Long-Running Batch Processing

```typescript
const batchJob = retryQ.createJob(async (signal) => {
  const results = [];

  for (const item of largeDataset) {
    // Check for cancellation before each item
    if (signal?.aborted) {
      console.log('Batch processing cancelled');
      break;
    }

    const result = await processItem(item);
    results.push(result);
  }

  return results;
}, {
  retries: 1,
  maxTime: 60000, // 1 minute
  label: 'batch-process'
});

// Graceful shutdown: cancel all running jobs
process.on('SIGTERM', () => {
  batchJob.cancel(true);
});
```

---

### Use Case 3: Polling with Abort

```typescript
async function pollUntilReady(signal) {
  while (true) {
    if (signal?.aborted) throw new Error('Polling cancelled');

    const status = await checkStatus(signal);
    if (status === 'ready') return status;

    await sleep(5000);
  }
}

const pollJob = retryQ.createJob(pollUntilReady, {
  retries: 100,
  delay: 5000
});

// Stop polling
pollJob.cancel(true);
```

---

### Use Case 4: Timeout with AbortController

```typescript
const timeoutController = new AbortController();
const timeout = setTimeout(() => timeoutController.abort(), 30000);

const job = retryQ.createJob(async (signal) => {
  // Job will be aborted after 30 seconds
  return await longOperation(signal);
}, {
  retries: 3,
  signal: timeoutController.signal
});

job.promise
  .then(result => {
    clearTimeout(timeout);
    console.log('Success:', result);
  })
  .catch(err => {
    console.log('Failed or timed out:', err.message);
  });
```

---

## Migration Guide

### From v1.0.x to v1.1.x (Force Cancellation)

**No breaking changes!** Your existing code continues to work.

**Optional: Opt into force cancellation**

**Before (v1.0.x)**:
```typescript
const job = retryQ.createJob(async () => {
  await doWork();
}, { retries: 5 });

job.cancel(); // Cooperative cancellation only
```

**After (v1.1.x with force cancel)**:
```typescript
const job = retryQ.createJob(async (signal) => {
  // Add signal parameter (optional)
  if (signal?.aborted) throw new Error('Aborted');
  await doWork();
}, { retries: 5 });

job.cancel(true); // Now supports force cancellation!
```

---

## Performance Considerations

### Signal Checking Overhead

Checking `signal?.aborted` has **negligible performance impact**:

```typescript
// Benchmark: 1 million signal checks
console.time('signal checks');
for (let i = 0; i < 1_000_000; i++) {
  if (signal?.aborted) break;
}
console.timeEnd('signal checks');
// Result: ~2-3ms on average hardware
```

**Recommendation**: Check signal at logical breakpoints, not every single operation.

---

## FAQ

**Q: Do I need to update my existing code?**
A: No! Force cancellation is opt-in. Existing code works unchanged.

**Q: What happens if I don't use the signal parameter?**
A: Cooperative cancellation still works (prevents retries, interrupts sleep). Force cancel just won't abort in-progress execution.

**Q: Can I use force cancel without checking signal in my function?**
A: Yes, but it won't abort the function execution. It will still prevent retries and interrupt sleep.

**Q: Does this work with TypeScript?**
A: Yes! Full type support with proper `AbortSignal` types.

**Q: Can I combine external and internal AbortControllers?**
A: Yes! Pass an external signal via options, and the internal signal will be linked.

**Q: What happens if both external and internal signals are aborted?**
A: The first abortion wins. Job stops immediately.

---

## Troubleshooting

### Issue: Force cancel doesn't abort my function

**Problem**: Calling `job.cancel(true)` but function keeps running

**Solution**: Add signal checks in your function
```typescript
// Before (doesn't abort)
async () => {
  await longOperation();
}

// After (aborts)
async (signal) => {
  if (signal?.aborted) throw new Error('Aborted');
  await longOperation();
}
```

---

### Issue: TypeError: signal is undefined

**Problem**: Accessing signal properties without optional chaining

**Solution**: Always use `?.` when accessing signal
```typescript
// BAD
if (signal.aborted) ...

// GOOD
if (signal?.aborted) ...
```

---

### Issue: Job state shows "failed" instead of "cancelled"

**Problem**: Job function throws error before checking signal

**Solution**: Check signal before operations that might fail
```typescript
async (signal) => {
  if (signal?.aborted) throw new Error('Aborted');
  // Now do work
}
```

---

## Summary

**Key Benefits**:
- ✅ Forcefully abort in-progress operations
- ✅ Standard `AbortController` API
- ✅ Works with fetch, axios, and custom code
- ✅ 100% backwards compatible
- ✅ Zero breaking changes
- ✅ Production tested

**When to Use Force Cancellation**:
- HTTP requests (fetch, axios)
- File uploads/downloads
- Long-running computations
- Polling operations
- Any interruptible async work

**When to Use Cooperative Cancellation**:
- Database transactions (need to commit/rollback cleanly)
- Critical operations (must complete atomically)
- Legacy code (doesn't support AbortSignal)

---

**Version**: 1.1.0
**Last Updated**: 2025-12-31
**Status**: Production Ready ✅
