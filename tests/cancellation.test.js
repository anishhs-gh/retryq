"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RetryQManager } = require("../dist/cjs/index.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("cooperative cancel stops future retries and preserves state", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const job = m.createJob(async () => {
    throw new Error("will fail");
  }, { retries: 5, delay: 100 });
  await sleep(120);
  job.cancel();
  await sleep(250);
  assert.equal(job.state, "cancelled");
  assert.equal(job.error.message, "Job cancelled");
});

test("cancelled jobs land in the cancelled bucket, not failed", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const job = m.createJob(async () => { await sleep(500); }, { retries: 0 });
  await sleep(20);
  job.cancel();
  await sleep(20);
  const s = m.listJobs();
  assert.equal(s.cancelled.length, 1);
  assert.equal(s.failed.length, 0);
  assert.equal(s.cancelled[0].state, "cancelled");
});

test("cancel interrupts the retry delay quickly", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const job = m.createJob(async () => { throw new Error("fail"); }, { retries: 5, delay: 5000 });
  await sleep(50); // first attempt fails, now sleeping ~5s
  const start = Date.now();
  job.cancel();
  await sleep(50);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `responded in ${elapsed}ms`);
  assert.equal(job.state, "cancelled");
});

test("double cancel is idempotent", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const job = m.createJob(async () => { await sleep(200); }, { retries: 0 });
  await sleep(20);
  job.cancel();
  job.cancel();
  await sleep(20);
  const s = m.listJobs();
  assert.equal(s.cancelled.length, 1);
  assert.equal(job.state, "cancelled");
});

test("force cancel aborts an in-flight, signal-aware attempt", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  let aborted = false;
  const job = m.createJob(async (signal) => {
    for (let i = 0; i < 100; i++) {
      if (signal?.aborted) { aborted = true; throw new Error("aborted"); }
      await sleep(20);
    }
    return "done";
  }, { retries: 0, maxTime: 10000 });
  await sleep(30);
  job.cancel(true);
  await sleep(50);
  assert.equal(aborted, true);
  assert.equal(job.state, "cancelled");
});

test("external AbortSignal force-cancels the job", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  const controller = new AbortController();
  let aborted = false;
  const job = m.createJob(async (signal) => {
    while (true) {
      if (signal?.aborted) { aborted = true; throw new Error("aborted"); }
      await sleep(20);
    }
  }, { retries: 0, maxTime: 10000, signal: controller.signal });
  await sleep(30);
  controller.abort();
  await sleep(60);
  assert.equal(aborted, true);
});

test("onCancel callback and cancel event both fire", async () => {
  const m = new RetryQManager({ maxConcurrent: 1 });
  let cbCalled = false;
  let evtCalled = false;
  m.on("cancel", () => (evtCalled = true));
  const job = m.createJob(async () => { await sleep(200); }, {
    retries: 0,
    onCancel: () => (cbCalled = true),
  });
  await sleep(20);
  job.cancel();
  await sleep(20);
  assert.equal(cbCalled, true);
  assert.equal(evtCalled, true);
});
