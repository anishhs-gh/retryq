/**
 * Comprehensive Verification Tests for @anishhs/retryq
 *
 * This file tests all critical fixes applied to the package:
 * - Memory management (bounded history)
 * - Unhandled rejection protection
 * - Concurrency control
 * - State consistency
 * - Input validation
 * - Cancellation behavior
 *
 * Run: node tests/verification.test.js
 */

const { RetryQManager } = require('../dist/index.js');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║   @anishhs/retryq - Critical Fixes Verification Tests         ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// ============================================================================
// TEST 1: Bounded Memory Growth (Fix #1)
// ============================================================================
async function test1_boundedMemory() {
  console.log('\n📋 TEST 1: Bounded Memory Growth');
  console.log('Testing: maxHistorySize limits and LRU eviction\n');

  const manager = new RetryQManager({ maxConcurrent: 10, maxHistorySize: 5 });

  const jobs = [];
  for (let i = 0; i < 10; i++) {
    const job = manager.createJob(async () => `result-${i}`, {
      label: `job-${i}`,
      retries: 0
    });
    jobs.push(job);
  }

  await Promise.allSettled(jobs.map(j => j.promise));
  await sleep(100);

  const state = manager.listJobs();

  assert(state.completed.length <= 5, `Completed jobs bounded to maxHistorySize (${state.completed.length} <= 5)`);
  assert(state.pending.length === 0, 'No pending jobs remain');
  assert(state.running.length === 0, 'No running jobs remain');

  console.log(`  Completed jobs in history: ${state.completed.length}/5 (LRU eviction working)`);
}

// ============================================================================
// TEST 2: Unhandled Promise Rejection Protection (Fix #2)
// ============================================================================
async function test2_unhandledRejection() {
  console.log('\n📋 TEST 2: Unhandled Promise Rejection Protection');
  console.log('Testing: Jobs without .catch() handlers don\'t crash process\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let unhandledRejectionDetected = false;
  const unhandledHandler = () => {
    unhandledRejectionDetected = true;
  };
  process.on('unhandledRejection', unhandledHandler);

  const job = manager.createJob(async () => {
    throw new Error('Test failure');
  }, { retries: 1, delay: 50 });

  await sleep(200);

  process.removeListener('unhandledRejection', unhandledHandler);

  assert(!unhandledRejectionDetected, 'No unhandled rejection detected (internal handler working)');
  assert(job.state === 'failed', 'Job correctly marked as failed');
  assert(job.error !== undefined, 'Error captured in job.error');
}

// ============================================================================
// TEST 3: Race Condition in _processQueue (Fix #3)
// ============================================================================
async function test3_noConcurrencyViolation() {
  console.log('\n📋 TEST 3: Race Condition Prevention');
  console.log('Testing: maxConcurrent limit is never violated\n');

  const manager = new RetryQManager({ maxConcurrent: 2 });

  let maxConcurrent = 0;
  let currentlyRunning = 0;

  const jobs = [];
  for (let i = 0; i < 10; i++) {
    const job = manager.createJob(async () => {
      currentlyRunning++;
      maxConcurrent = Math.max(maxConcurrent, currentlyRunning);
      await sleep(50);
      currentlyRunning--;
      return `result-${i}`;
    }, { label: `job-${i}`, retries: 0 });
    jobs.push(job);
  }

  await Promise.allSettled(jobs.map(j => j.promise));
  await sleep(100);

  assert(maxConcurrent <= 2, `Max concurrent execution respected (${maxConcurrent} <= 2)`);
  console.log(`  Peak concurrent jobs: ${maxConcurrent}/2`);
}

// ============================================================================
// TEST 4: Input Validation (Fix #7)
// ============================================================================
async function test4_inputValidation() {
  console.log('\n📋 TEST 4: Input Validation');
  console.log('Testing: Invalid inputs are rejected with clear errors\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  // Test 4a: Negative retries
  try {
    manager.createJob(async () => {}, { retries: -1 });
    assert(false, 'Should throw on negative retries');
  } catch (err) {
    assert(err.message.includes('retries must be >= 0'), 'Negative retries rejected');
  }

  // Test 4b: Excessive retries (DoS protection)
  try {
    manager.createJob(async () => {}, { retries: 200 });
    assert(false, 'Should throw on excessive retries');
  } catch (err) {
    assert(err.message.includes('cannot exceed 100'), 'Excessive retries rejected (DoS protection)');
  }

  // Test 4c: Negative delay
  try {
    manager.createJob(async () => {}, { delay: -100 });
    assert(false, 'Should throw on negative delay');
  } catch (err) {
    assert(err.message.includes('delay must be >= 0'), 'Negative delay rejected');
  }

  // Test 4d: Invalid backoff
  try {
    manager.createJob(async () => {}, { backoff: 0.5 });
    assert(false, 'Should throw on backoff < 1');
  } catch (err) {
    assert(err.message.includes('backoff must be >= 1'), 'Invalid backoff rejected');
  }

  // Test 4e: Invalid jitter
  try {
    manager.createJob(async () => {}, { jitter: 1.5 });
    assert(false, 'Should throw on jitter > 1');
  } catch (err) {
    assert(err.message.includes('jitter must be between 0 and 1'), 'Invalid jitter rejected');
  }
}

// ============================================================================
// TEST 5: Cancelled State Preservation (Fix #8)
// ============================================================================
async function test5_cancelledStatePreserved() {
  console.log('\n📋 TEST 5: Cancelled State Preservation');
  console.log('Testing: Cancelled jobs remain "cancelled"\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  const job = manager.createJob(async () => {
    throw new Error('Will fail');
  }, { retries: 5, delay: 100 });

  await sleep(150);
  job.cancel();
  await sleep(300);

  assert(job.state === 'cancelled', `Job state is "cancelled": ${job.state}`);
  assert(job.error.message === 'Job cancelled', 'Error message indicates cancellation');
}

// ============================================================================
// TEST 6: clearHistory Method
// ============================================================================
async function test6_clearHistory() {
  console.log('\n📋 TEST 6: clearHistory Method');
  console.log('Testing: Manual history cleanup\n');

  const manager = new RetryQManager({ maxConcurrent: 5 });

  for (let i = 0; i < 5; i++) {
    const job = manager.createJob(async () => `result-${i}`, { retries: 0 });
    await job.promise.catch(() => {});
  }

  for (let i = 0; i < 3; i++) {
    const job = manager.createJob(async () => { throw new Error('fail'); }, { retries: 0 });
    await job.promise.catch(() => {});
  }

  await sleep(100);

  let state = manager.listJobs();
  const initialCompleted = state.completed.length;
  const initialFailed = state.failed.length;

  assert(initialCompleted > 0, `Has completed jobs: ${initialCompleted}`);
  assert(initialFailed > 0, `Has failed jobs: ${initialFailed}`);

  manager.clearHistory('completed');
  state = manager.listJobs();
  assert(state.completed.length === 0, 'Completed jobs cleared');
  assert(state.failed.length === initialFailed, 'Failed jobs unchanged');

  manager.clearHistory('failed');
  state = manager.listJobs();
  assert(state.failed.length === 0, 'Failed jobs cleared');

  console.log('  clearHistory() working correctly');
}

// ============================================================================
// TEST 7: ID Collision Resistance
// ============================================================================
async function test7_idCollisionResistance() {
  console.log('\n📋 TEST 7: ID Collision Resistance');
  console.log('Testing: IDs are unique even under high concurrency\n');

  const manager = new RetryQManager({ maxConcurrent: 100 });

  const jobs = [];
  const ids = new Set();

  for (let i = 0; i < 1000; i++) {
    const job = manager.createJob(async () => `result-${i}`, { retries: 0 });
    jobs.push(job);
    ids.add(job.id);
  }

  await Promise.allSettled(jobs.map(j => j.promise));

  assert(ids.size === 1000, `All 1000 IDs are unique (found ${ids.size} unique IDs)`);
  console.log(`  Generated 1000 unique IDs without collisions`);
}

// ============================================================================
// TEST 8: Concurrency Control Under Load
// ============================================================================
async function test8_concurrencyUnderLoad() {
  console.log('\n📋 TEST 8: Concurrency Control Under Load');
  console.log('Testing: maxConcurrent enforced with priority queue\n');

  const manager = new RetryQManager({ maxConcurrent: 3 });

  let maxConcurrent = 0;
  let currentRunning = 0;

  const jobs = [];
  for (let i = 0; i < 20; i++) {
    const job = manager.createJob(async () => {
      currentRunning++;
      maxConcurrent = Math.max(maxConcurrent, currentRunning);
      await sleep(30);
      currentRunning--;
      return i;
    }, {
      priority: i % 5,
      retries: 0
    });
    jobs.push(job);
  }

  await Promise.allSettled(jobs.map(j => j.promise));

  assert(maxConcurrent <= 3, `Concurrency limit enforced under load (max: ${maxConcurrent})`);
  assert(maxConcurrent === 3, `Full concurrency utilized (${maxConcurrent}/3)`);
  console.log(`  20 jobs processed with max ${maxConcurrent} concurrent`);
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================
async function runAllTests() {
  const tests = [
    test1_boundedMemory,
    test2_unhandledRejection,
    test3_noConcurrencyViolation,
    test4_inputValidation,
    test5_cancelledStatePreserved,
    test6_clearHistory,
    test7_idCollisionResistance,
    test8_concurrencyUnderLoad,
  ];

  for (const test of tests) {
    try {
      await test();
    } catch (err) {
      console.error(`\n❌ Test failed with error:`, err.message);
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📊 Total:  ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! All critical fixes verified.');
    process.exit(0);
  } else {
    console.log('\n⚠️  SOME TESTS FAILED. Review output above.');
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
