# RetryQ — Feature Report, Gaps & Update Plan

**Package:** `@anishhs/retryq` v1.1.0
**Repo:** anishhs-gh/retryq
**Reviewed:** 2026-06-26
**Scope reviewed:** `src/index.ts` (391 LOC, single file), README, CHANGELOG, tests, build config.

> **Status:** The Tier-1 plan (and the multi-file restructure, JSDoc, dual
> ESM/CJS build, and CI/CD overhaul) is **implemented in v1.2.0** — tracked in
> issue #3. Tier-3 items remain deferred to v2.0.0.

---

## 1. Executive Summary

RetryQ is a zero-dependency, in-memory retry-queue manager for Node.js with
concurrency control, priority scheduling, exponential backoff + jitter, and
cooperative/force cancellation. The current build typechecks cleanly (`tsc`
passes) and all three bundled test suites pass.

It is solid for its stated scope, but it is missing several features that users
of a retry library typically expect — most importantly **lifecycle events /
hooks**, a **retry predicate** (`shouldRetry`), a **way to await the whole queue
draining**, and a **real per-attempt timeout**. There are also two correctness
issues worth fixing: `maxTime` is not actually enforced *during* a running
attempt, and **cancelled jobs are stored in the `failed` bucket** so they never
surface as `cancelled` in `listJobs()`.

This document lists what exists, what's missing/broken, and a prioritized plan
for the next release (proposed **v1.2.0**, with one breaking item deferred to
v2.0.0).

---

## 2. Current Features (What Exists)

| Feature | Status | Notes |
|---|---|---|
| Concurrency control (`maxConcurrent`) | ✅ | Default `Infinity` (no limit unless set). |
| Priority queue | ✅ | Higher `priority` runs first; stable sort keeps FIFO within a priority. |
| Exponential backoff (`delay`, `backoff`) | ✅ | `currentDelay *= backoff` each retry. |
| Jitter | ✅ | `±(delay * jitter)`, clamped to `[0, maxTime - elapsed]`. |
| Retry count semantics | ✅ | `retriesLeft = retries + 1` (initial attempt + N retries). |
| Cooperative cancellation | ✅ | Stops future retries, interrupts the sleep between retries. |
| Force cancellation | ✅ | Aborts via internal `AbortController`; signal passed to `fn`. |
| External `AbortSignal` linking | ✅ | `options.signal` chained to the internal controller. |
| Bounded history + LRU eviction | ✅ | `maxHistorySize` (default 1000) per state map. |
| `clearHistory(state?)` | ✅ | Clears completed/failed. |
| Job introspection | ✅ | `listJobs`, `findJobById`, `findJobsByLabel`. |
| Input validation / DoS guards | ✅ | retries ≤ 100, jitter 0–1, backoff ≥ 1, etc. |
| Unhandled-rejection guard | ✅ | Internal `.catch()` on `job.promise`. |
| TypeScript types | ✅ | Bundled `.d.ts` via `tsc`. |
| Zero runtime dependencies | ✅ | |

---

## 3. Gaps & Issues

### 3.1 Correctness bugs (fix first)

**B1 — `maxTime` does not bound a running attempt.**
`maxTime` is only checked at the *top* of the retry loop
(`if (elapsed >= maxTime) break;`, `src/index.ts:246-247`). If a single
`await job.fn(signal)` call runs longer than `maxTime`, nothing interrupts it
unless `fn` itself honors the abort signal. The README sells `maxTime` as a
"Global timeout per job" — today it's really "don't *start another retry* after
maxTime." There is no timer that aborts the in-flight attempt.
*Impact:* a hung request with no internal timeout ignores `maxTime` entirely.

**B2 — Cancelled jobs are stored in the `failed` bucket.**
`cancelJob()` does `this.failedJobs.set(id, job)` (`src/index.ts:337-338`), and
`listJobs()` returns no `cancelled` group. So a cancelled job shows up under
`failed` (with `state: "cancelled"`). The tests even assert this
("Job found in failed queue with state=cancelled"). It's internally consistent
but surprising and makes it impossible to query cancelled jobs as a group.

**B3 — External-signal listener is never removed.**
`options.signal.addEventListener('abort', …)` (`src/index.ts:145-149`) is never
torn down on completion. For a long-lived shared `AbortSignal` used across many
jobs, that's a slow listener leak.

### 3.2 Missing features (high user value)

**G1 — No lifecycle events / hooks.** No `EventEmitter` and no per-job callbacks
(`onRetry`, `onSuccess`, `onFailure`, `onCancel`). This is the single most-
requested capability for a retry library — needed for logging, metrics, and
backoff observability. Today the only feedback is the resolved/rejected promise.

**G2 — No retry predicate (`shouldRetry` / `retryOn`).** Every error retries
until exhaustion. There's no way to say "don't retry 4xx, do retry 5xx/network."
This causes wasted retries on permanent failures.

**G3 — No way to await the queue draining.** No `onIdle()` / `drain()` /
`await all()`. Callers must hold every job and `Promise.allSettled` manually
(the README's graceful-shutdown example does exactly this). A built-in
`onIdle(): Promise<void>` would be a big ergonomics win.

**G4 — No pause / resume.** Can't stop dispatching new jobs (e.g. on a circuit-
breaker trip or backpressure) without cancelling.

**G5 — No `maxDelay` cap.** `currentDelay` grows unbounded by `backoff`; only the
*sleep* is clamped to remaining `maxTime`. A `maxDelay` option (cap per-retry
delay) is standard in retry libs.

**G6 — No result/return typing.** `fn` and `job.promise` are `Promise<any>`.
A generic `createJob<T>` → `RetryQJob<T>` would give callers real return types.

### 3.3 Packaging / project gaps

**P1 — CJS-only, no `exports` map.** `main: dist/index.js`, no `module`/`exports`
fields. Modern ESM consumers and bundlers benefit from a dual build + `exports`.

**P2 — Custom test scripts, no framework / no coverage.** Tests are hand-rolled
`node tests/*.js` scripts. No assertion library, no coverage, and CI doesn't
gate on them (`publish.yml` should run `npm test` before publish — needs
confirming).

**P3 — `engines` field missing.** README says "Node 16+" but `package.json` has
no `engines` constraint.

**P4 — Busy-wait dispatch.** `_runJob` spins on
`while (!this.runningJobs.has(job.id)) { await setTimeout(0) }`
(`src/index.ts:203-216`). Each pending job polls every macrotask tick. Works,
but it's CPU-wasteful under deep queues and the dispatch logic is harder to
reason about than an explicit "pull next on slot free" loop.

### 3.4 Out of scope (acknowledged, not bugs)

- No persistence / durability (in-memory only — fine for the stated use case).
- No distributed/multi-process coordination (use Redis/BullMQ for that).

---

## 4. Recommended Update — Proposed v1.2.0

Ordered by value-to-effort. Items 1–4 are non-breaking and high impact.

### Tier 1 — Ship in v1.2.0 (non-breaking)

1. **Lifecycle events (G1).** Add an `EventEmitter` on the manager
   (`'retry'`, `'success'`, `'failure'`, `'cancel'`) **and** optional per-job
   callbacks in `RetryQJobOptions` (`onRetry(attempt, err, nextDelay)`,
   `onSuccess(result)`, `onFailure(err)`). Highest user value, fully additive.

2. **`shouldRetry` predicate (G2).** Add
   `options.shouldRetry?: (error, attempt) => boolean`. When it returns `false`,
   stop immediately and mark failed. Default keeps current behavior.

3. **`onIdle()` / `drain()` (G3).** Add `manager.onIdle(): Promise<void>` that
   resolves when `pending` and `running` are both empty. Removes the manual
   `Promise.allSettled` boilerplate.

4. **`maxDelay` cap (G5)** and **generic typing (G6)**:
   `createJob<T>(fn): RetryQJob<T>`. Both additive.

5. **Fix B2 surfacing.** Add a `cancelled` map + a `cancelled` group in
   `listJobs()`. Keep cancelled out of `failed`. *(Behavior change in
   `listJobs()` output — call it out in release notes; arguably a bugfix.)*

6. **Fix B1 — real per-attempt timeout.** Wrap each `fn` attempt in a timeout
   that aborts the internal `AbortController` and rejects when the attempt
   exceeds the remaining `maxTime` (or a new `attemptTimeout` option). This makes
   the documented "global timeout" actually true.

7. **Fix B3** — remove the abort listener on settle.

### Tier 2 — Project health

8. **CI gate** — ensure `publish.yml` runs `npm test` (and `tsc --noEmit`)
   before publishing; add `engines: { node: ">=16" }` (P3).
9. **Dual ESM/CJS build + `exports` map** (P1).
10. **Migrate tests to a runner** (node:test or vitest) with coverage (P2).

### Tier 3 — Deferred to v2.0.0 (breaking / larger)

11. **Pause/resume** (`pause()` / `resume()`) (G4).
12. **Rework dispatch** to remove the busy-wait (P4) — event-driven "dispatch on
    slot free" loop.
13. **`Promise<any>` → `Promise<unknown>`** and stricter error typing across the
    public API (breaking for some callers).

---

## 5. Suggested API additions (sketch)

```typescript
type RetryQJobOptions<T = any> = {
  // ...existing...
  maxDelay?: number;                                  // G5: cap per-retry delay
  attemptTimeout?: number;                            // B1: bound a single attempt
  shouldRetry?: (error: unknown, attempt: number) => boolean;   // G2
  onRetry?: (attempt: number, error: unknown, nextDelayMs: number) => void; // G1
  onSuccess?: (result: T) => void;
  onFailure?: (error: unknown) => void;
};

interface RetryQManager {
  onIdle(): Promise<void>;                            // G3
  on(event: 'retry'|'success'|'failure'|'cancel', cb: (job: RetryQJob) => void): void; // G1
  // listJobs() now also returns `cancelled: JobSummary[]`  (B2)
}

createJob<T>(fn: (signal?: AbortSignal) => Promise<T>, opts?: RetryQJobOptions<T>): RetryQJob<T>; // G6
```

---

## 6. Quick wins (a few hours total)

- `engines` field + CI `npm test` gate (P2/P3).
- Remove abort listener on settle (B3).
- Add `cancelled` to `listJobs()` (B2 surface).
- `maxDelay` option (G5).

## 7. Highest leverage (do these for the headline of v1.2.0)

- Lifecycle events/hooks (G1).
- `shouldRetry` predicate (G2).
- `onIdle()` (G3).
- Real `maxTime`/attempt timeout (B1).

---

*Verification at review time: `npx tsc --noEmit` → clean; `npm test` → all suites
pass (verification, force-cancellation, cancellation-proof). Findings above are
from static reading of `src/index.ts` plus observed test behavior.*
