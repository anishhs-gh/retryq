# Tests

The suite uses Node's built-in [`node:test`](https://nodejs.org/api/test.html)
runner (no external test dependencies). Tests import the **built** CommonJS
output, so the package is compiled first.

## Running

```bash
npm test          # builds (pretest) then runs `node --test tests/`
```

To run a single file:

```bash
npm run build
node --test tests/features.test.js
```

## Files

### `core.test.js`
Core manager behavior: bounded LRU history, unhandled-rejection safety,
`maxConcurrent` enforcement, input validation, id uniqueness under load,
`clearHistory`, retry semantics, generic result typing, the legacy numeric
constructor, and priority ordering.

### `cancellation.test.js`
Cooperative and force cancellation: state preservation, the dedicated
`cancelled` bucket, interrupting the retry delay, idempotent double-cancel,
aborting signal-aware work, external `AbortSignal` linking, and the `onCancel`
callback / `cancel` event.

### `features.test.js` (v1.2.0)
New capabilities: lifecycle events (`retry`/`success`/`failure`/`idle`),
per-job callbacks, the `shouldRetry` predicate, `onIdle()` / `drain()`,
`maxDelay` capping, real `maxTime` enforcement (`RetryQTimeoutError`),
`attemptTimeout`, and cross-state lookup of cancelled jobs.

> These tests are for developers/contributors and are excluded from the
> published package via `.npmignore`.
