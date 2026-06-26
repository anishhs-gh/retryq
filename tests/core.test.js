"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RetryQManager } = require("../dist/cjs/index.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("bounded history evicts oldest (LRU) at maxHistorySize", async () => {
  const m = new RetryQManager({ maxConcurrent: 10, maxHistorySize: 5 });
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(m.createJob(async () => `r-${i}`, { retries: 0 }));
  }
  await Promise.allSettled(jobs.map((j) => j.promise));
  const s = m.listJobs();
  assert.ok(s.completed.length <= 5, `completed bounded (${s.completed.length})`);
  assert.equal(s.pending.length, 0);
  assert.equal(s.running.length, 0);
});

test("no unhandled rejection when consumer omits .catch()", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  let unhandled = false;
  const handler = () => (unhandled = true);
  process.on("unhandledRejection", handler);
  const job = m.createJob(async () => {
    throw new Error("boom");
  }, { retries: 1, delay: 20 });
  await sleep(150);
  process.removeListener("unhandledRejection", handler);
  assert.equal(unhandled, false);
  assert.equal(job.state, "failed");
  assert.ok(job.error instanceof Error);
});

test("maxConcurrent is never exceeded", async () => {
  const m = new RetryQManager({ maxConcurrent: 2 });
  let running = 0;
  let peak = 0;
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(
      m.createJob(async () => {
        running++;
        peak = Math.max(peak, running);
        await sleep(30);
        running--;
      }, { retries: 0 })
    );
  }
  await Promise.allSettled(jobs.map((j) => j.promise));
  assert.ok(peak <= 2, `peak ${peak}`);
});

test("input validation rejects bad options", () => {
  const m = new RetryQManager(1);
  assert.throws(() => m.createJob(async () => {}, { retries: -1 }), /retries must be >= 0/);
  assert.throws(() => m.createJob(async () => {}, { retries: 200 }), /cannot exceed 100/);
  assert.throws(() => m.createJob(async () => {}, { delay: -1 }), /delay must be >= 0/);
  assert.throws(() => m.createJob(async () => {}, { backoff: 0.5 }), /backoff must be >= 1/);
  assert.throws(() => m.createJob(async () => {}, { jitter: 1.5 }), /jitter must be between 0 and 1/);
  assert.throws(() => m.createJob(async () => {}, { maxDelay: -1 }), /maxDelay must be >= 0/);
  assert.throws(() => m.createJob(async () => {}, { attemptTimeout: 0 }), /attemptTimeout must be > 0/);
});

test("ids are unique under load", async () => {
  const m = new RetryQManager({ maxConcurrent: 100 });
  const ids = new Set();
  const jobs = [];
  for (let i = 0; i < 1000; i++) {
    const j = m.createJob(async () => i, { retries: 0 });
    ids.add(j.id);
    jobs.push(j);
  }
  await Promise.allSettled(jobs.map((j) => j.promise));
  assert.equal(ids.size, 1000);
});

test("clearHistory clears the requested buckets", async () => {
  const m = new RetryQManager({ maxConcurrent: 5 });
  for (let i = 0; i < 4; i++) await m.createJob(async () => i, { retries: 0 }).promise.catch(() => {});
  for (let i = 0; i < 3; i++) await m.createJob(async () => { throw new Error("x"); }, { retries: 0 }).promise.catch(() => {});
  let s = m.listJobs();
  assert.ok(s.completed.length > 0 && s.failed.length > 0);
  m.clearHistory("completed");
  s = m.listJobs();
  assert.equal(s.completed.length, 0);
  assert.ok(s.failed.length > 0);
  m.clearHistory();
  s = m.listJobs();
  assert.equal(s.failed.length, 0);
});

test("retry semantics: retries:0 means exactly one attempt", async () => {
  const m = new RetryQManager(1);
  let attempts = 0;
  const job = m.createJob(async () => {
    attempts++;
    throw new Error("nope");
  }, { retries: 0, delay: 1 });
  await job.promise.catch(() => {});
  assert.equal(attempts, 1);
  assert.equal(job.state, "failed");
});

test("successful job resolves with the function's return value (generic)", async () => {
  const m = new RetryQManager(1);
  const job = m.createJob(async () => ({ ok: true, n: 42 }), { retries: 0 });
  const result = await job.promise;
  assert.deepEqual(result, { ok: true, n: 42 });
  assert.equal(job.state, "completed");
});

test("legacy numeric constructor still sets maxConcurrent", async () => {
  const m = new RetryQManager(1);
  let running = 0;
  let peak = 0;
  const jobs = [];
  for (let i = 0; i < 5; i++) {
    jobs.push(m.createJob(async () => { running++; peak = Math.max(peak, running); await sleep(15); running--; }, { retries: 0 }));
  }
  await Promise.allSettled(jobs.map((j) => j.promise));
  assert.equal(peak, 1);
});

test("backward compatible: v1.0/v1.1-style usage still works", async () => {
  // Numeric constructor, function with no signal parameter, classic options,
  // and cooperative cancel() with no argument — all pre-v1.2 patterns.
  const m = new RetryQManager(2);

  // fn with no signal param (old signature) resolving normally
  const ok = await m.createJob(async () => "legacy", {
    retries: 3,
    delay: 10,
    backoff: 2,
    jitter: 0.1,
  }).promise;
  assert.equal(ok, "legacy");

  // Retries then fail, old-style error access via job.error
  let tries = 0;
  const failing = m.createJob(async () => {
    tries++;
    throw new Error("legacy-fail");
  }, { retries: 2, delay: 5 });
  await failing.promise.catch(() => {});
  assert.equal(tries, 3);
  assert.equal(failing.state, "failed");
  assert.equal(failing.error.message, "legacy-fail");

  // listJobs() still exposes the original buckets
  const s = m.listJobs();
  for (const key of ["pending", "running", "failed", "completed"]) {
    assert.ok(Array.isArray(s[key]), `${key} is an array`);
  }

  // Cooperative cancel(false) keeps working
  const c = m.createJob(async () => { await sleep(200); }, { retries: 0 });
  await sleep(20);
  c.cancel();
  await sleep(20);
  assert.equal(c.state, "cancelled");
});

test("priority: higher priority runs before lower", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const order = [];
  // First job occupies the single slot.
  m.createJob(async () => { await sleep(20); }, { retries: 0, label: "blocker" });
  m.createJob(async () => { order.push("low"); }, { retries: 0, priority: 1 });
  m.createJob(async () => { order.push("high"); }, { retries: 0, priority: 10 });
  await m.onIdle();
  assert.deepEqual(order, ["high", "low"]);
});
