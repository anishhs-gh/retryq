"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RetryQManager, RetryQTimeoutError } = require("../dist/cjs/index.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("success/failure lifecycle events fire with payloads", async () => {
  const m = new RetryQManager({ maxConcurrent: 2 });
  const events = { success: 0, failure: 0 };
  m.on("success", ({ job, result }) => {
    events.success++;
    assert.ok(job.id);
    assert.equal(result, "ok");
  });
  m.on("failure", ({ job, error }) => {
    events.failure++;
    assert.ok(error instanceof Error);
  });
  await m.createJob(async () => "ok", { retries: 0 }).promise;
  await m.createJob(async () => { throw new Error("x"); }, { retries: 0 }).promise.catch(() => {});
  assert.equal(events.success, 1);
  assert.equal(events.failure, 1);
});

test("retry event + onRetry fire on each scheduled retry", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const retries = [];
  m.on("retry", ({ info }) => retries.push(info.attempt));
  let onRetryCalls = 0;
  const job = m.createJob(async () => { throw new Error("fail"); }, {
    retries: 2,
    delay: 10,
    onRetry: () => onRetryCalls++,
  });
  await job.promise.catch(() => {});
  // 3 attempts total => 2 retries scheduled.
  assert.deepEqual(retries, [1, 2]);
  assert.equal(onRetryCalls, 2);
});

test("shouldRetry:false stops immediately without retrying", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  let attempts = 0;
  let retryEvents = 0;
  m.on("retry", () => retryEvents++);
  const job = m.createJob(async () => {
    attempts++;
    throw new Error("permanent");
  }, { retries: 5, delay: 10, shouldRetry: () => false });
  await job.promise.catch(() => {});
  assert.equal(attempts, 1);
  assert.equal(retryEvents, 0);
  assert.equal(job.state, "failed");
});

test("shouldRetry receives error and attempt number", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const seen = [];
  const job = m.createJob(async () => { throw new Error("e"); }, {
    retries: 3,
    delay: 5,
    shouldRetry: (err, attempt) => {
      seen.push(attempt);
      return attempt < 2; // allow one retry only
    },
  });
  await job.promise.catch(() => {});
  assert.deepEqual(seen, [1, 2]);
  assert.equal(job.state, "failed");
});

test("onIdle resolves when the queue drains", async () => {
  const m = new RetryQManager({ maxConcurrent: 2 });
  for (let i = 0; i < 6; i++) m.createJob(async () => { await sleep(20); }, { retries: 0 });
  await m.onIdle();
  const s = m.listJobs();
  assert.equal(s.pending.length, 0);
  assert.equal(s.running.length, 0);
});

test("drain() is an alias for onIdle() and resolves immediately when idle", async () => {
  const m = new RetryQManager();
  await m.drain(); // already idle
  m.createJob(async () => { await sleep(15); }, { retries: 0 });
  await m.drain();
  assert.equal(m.listJobs().running.length, 0);
});

test("idle event fires on transition to idle", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  let idleCount = 0;
  m.on("idle", () => idleCount++);
  m.createJob(async () => { await sleep(15); }, { retries: 0 });
  await m.onIdle();
  await sleep(5);
  assert.equal(idleCount, 1);
});

test("maxDelay caps the backoff delay", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const delays = [];
  const job = m.createJob(async () => { throw new Error("fail"); }, {
    retries: 3,
    delay: 1000,
    backoff: 10,
    jitter: 0,
    maxDelay: 50,
    maxTime: 60000,
    onRetry: (info) => delays.push(info.nextDelay),
  });
  await job.promise.catch(() => {});
  for (const d of delays) assert.ok(d <= 50, `delay ${d} <= 50`);
});

test("maxTime aborts a long-running attempt that ignores its signal", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const start = Date.now();
  const job = m.createJob(
    // Never resolves and ignores the abort signal.
    () => new Promise(() => {}),
    { retries: 0, maxTime: 150 }
  );
  await job.promise.catch(() => {});
  const elapsed = Date.now() - start;
  assert.equal(job.state, "failed");
  assert.ok(elapsed < 1500, `bounded by maxTime (${elapsed}ms)`);
  assert.ok(job.error instanceof RetryQTimeoutError);
});

test("attemptTimeout bounds each attempt and still retries", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  let attempts = 0;
  const job = m.createJob(
    () => { attempts++; return new Promise(() => {}); },
    { retries: 1, delay: 10, attemptTimeout: 80, maxTime: 60000 }
  );
  await job.promise.catch(() => {});
  assert.equal(attempts, 2);
  assert.equal(job.state, "failed");
});

test("findJobById and findJobsByLabel locate cancelled jobs too", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const job = m.createJob(async () => { await sleep(200); }, { retries: 0, label: "tagged" });
  await sleep(20);
  job.cancel();
  await sleep(20);
  assert.equal(m.findJobById(job.id)?.state, "cancelled");
  assert.equal(m.findJobsByLabel("tagged").length, 1);
});
