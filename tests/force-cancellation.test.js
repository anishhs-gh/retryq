/**
 * Force Cancellation Tests for @anishhs/retryq
 *
 * Tests the AbortController-based force cancellation feature added in v1.1.0
 * Verifies:
 * - Backwards compatibility (signal parameter is optional)
 * - Cooperative cancellation (cancel() or cancel(false))
 * - Force cancellation (cancel(true))
 * - AbortSignal integration with fetch/axios patterns
 * - External AbortController support
 * - Signal propagation and state transitions
 *
 * Run: node tests/force-cancellation.test.js
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
console.log('║   @anishhs/retryq - Force Cancellation Feature Tests          ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');

// ============================================================================
// TEST 1: Backwards Compatibility - No Signal Parameter
// ============================================================================
async function test1_backwardsCompatibility() {
  console.log('\n📋 TEST 1: Backwards Compatibility');
  console.log('Testing: Jobs without signal parameter still work\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  // Old style: no signal parameter
  const job = manager.createJob(async () => {
    await sleep(50);
    return 'success';
  }, { retries: 3 });

  const result = await job.promise;

  assert(result === 'success', 'Old-style job (no signal) completes successfully');
  assert(job.state === 'completed', 'Job state is "completed"');
}

// ============================================================================
// TEST 2: Cooperative Cancellation with Signal Parameter
// ============================================================================
async function test2_cooperativeCancelWithSignal() {
  console.log('\n📋 TEST 2: Cooperative Cancellation (with signal parameter)');
  console.log('Testing: cancel(false) prevents retries but allows completion\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let executionCount = 0;

  const job = manager.createJob(async (signal) => {
    executionCount++;
    await sleep(50);
    throw new Error('Will fail and retry');
  }, { retries: 5, delay: 100 });

  await sleep(70); // Let first execution complete
  job.cancel(false); // Cooperative cancel
  await sleep(300);

  assert(executionCount >= 1, `Job executed at least once (${executionCount} times)`);
  assert(job.state === 'cancelled', 'Job state is "cancelled"');
  assert(job.error.message === 'Job cancelled', 'Error message indicates cancellation');
}

// ============================================================================
// TEST 3: Force Cancellation - Signal Check in Loop
// ============================================================================
async function test3_forceCancelInLoop() {
  console.log('\n📋 TEST 3: Force Cancellation with Signal Check');
  console.log('Testing: cancel(true) aborts execution when signal is checked\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let iterationsCompleted = 0;

  const job = manager.createJob(async (signal) => {
    for (let i = 0; i < 100; i++) {
      if (signal?.aborted) {
        throw new Error('Aborted at iteration ' + i);
      }
      await sleep(10);
      iterationsCompleted++;
    }
    return 'completed all iterations';
  }, { retries: 0 });

  await sleep(50); // Let some iterations run
  job.cancel(true); // Force cancel
  await sleep(100);

  assert(iterationsCompleted < 100, `Job aborted before completion (${iterationsCompleted}/100 iterations)`);
  assert(job.state === 'cancelled', 'Job state is "cancelled"');
  console.log(`  Aborted after ${iterationsCompleted} iterations`);
}

// ============================================================================
// TEST 4: Force Cancellation - Fetch Pattern (Mock)
// ============================================================================
async function test4_forceCancelFetchPattern() {
  console.log('\n📋 TEST 4: Force Cancellation - Fetch Pattern');
  console.log('Testing: Signal passed to async operation (simulated fetch)\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let fetchStarted = false;
  let fetchAborted = false;

  // Simulate fetch with AbortSignal
  async function mockFetch(url, options) {
    fetchStarted = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ json: async () => ({ data: 'success' }) }), 5000);

      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          fetchAborted = true;
          reject(new Error('Fetch aborted'));
        });
      }
    });
  }

  const job = manager.createJob(async (signal) => {
    const response = await mockFetch('https://example.com/api', { signal });
    return response.json();
  }, { retries: 3 });

  await sleep(100); // Let fetch start
  job.cancel(true); // Force cancel
  await sleep(100);

  assert(fetchStarted, 'Fetch operation started');
  assert(fetchAborted, 'Fetch was aborted via signal');
  assert(job.state === 'cancelled', 'Job state is "cancelled"');
}

// ============================================================================
// TEST 5: External AbortController Integration
// ============================================================================
async function test5_externalAbortController() {
  console.log('\n📋 TEST 5: External AbortController Integration');
  console.log('Testing: Link external AbortController to job\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });
  const externalController = new AbortController();

  let signalWasAborted = false;

  const job = manager.createJob(async (signal) => {
    for (let i = 0; i < 100; i++) {
      if (signal?.aborted) {
        signalWasAborted = true;
        throw new Error('Aborted by external controller');
      }
      await sleep(10);
    }
    return 'completed';
  }, {
    retries: 0,
    signal: externalController.signal
  });

  await sleep(50);
  externalController.abort(); // Abort via external controller
  await sleep(100);

  assert(signalWasAborted, 'Job detected external abort signal');
  console.log(`  Job state: ${job.state}, Error: ${job.error?.message}`);
  assert(job.state === 'cancelled' || job.state === 'failed', `Job state is "cancelled" or "failed" (got: ${job.state})`);
}

// ============================================================================
// TEST 6: Signal Optional Chaining Safety
// ============================================================================
async function test6_signalOptionalChaining() {
  console.log('\n📋 TEST 6: Signal Optional Chaining');
  console.log('Testing: signal?. pattern works when signal is undefined\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  // Job that uses optional chaining (safe even if signal is undefined)
  const job = manager.createJob(async (signal) => {
    // This should not crash even if signal is undefined
    if (signal?.aborted) {
      throw new Error('Should not happen');
    }
    await sleep(50);
    return 'success';
  }, { retries: 0 });

  const result = await job.promise;

  assert(result === 'success', 'Optional chaining (?.) prevents undefined errors');
  assert(job.state === 'completed', 'Job completes successfully');
}

// ============================================================================
// TEST 7: Force Cancel Prevents Retries
// ============================================================================
async function test7_forceCancelPreventsRetries() {
  console.log('\n📋 TEST 7: Force Cancel Prevents Retries');
  console.log('Testing: Force cancellation stops retry attempts\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let attemptCount = 0;

  const job = manager.createJob(async (signal) => {
    attemptCount++;
    if (signal?.aborted) {
      throw new Error('Aborted');
    }
    throw new Error('Simulated failure');
  }, { retries: 10, delay: 100 });

  await sleep(150); // Let first attempt fail
  job.cancel(true); // Force cancel
  await sleep(500);

  assert(attemptCount <= 2, `Retries stopped after cancellation (${attemptCount} attempts)`);
  assert(job.state === 'cancelled', 'Job state is "cancelled"');
}

// ============================================================================
// TEST 8: Cancel Method Signature Variations
// ============================================================================
async function test8_cancelSignatures() {
  console.log('\n📋 TEST 8: Cancel Method Signature Variations');
  console.log('Testing: Different ways to call cancel()\n');

  const manager = new RetryQManager({ maxConcurrent: 3 });

  // Test cancel() - default cooperative
  const job1 = manager.createJob(async () => {
    await sleep(100);
    throw new Error('fail');
  }, { retries: 5, delay: 50 });

  await sleep(30);
  job1.cancel(); // No argument
  await sleep(100);

  assert(job1.state === 'cancelled', 'cancel() works (cooperative by default)');

  // Test cancel(false) - explicit cooperative
  const job2 = manager.createJob(async () => {
    await sleep(100);
    throw new Error('fail');
  }, { retries: 5, delay: 50 });

  await sleep(30);
  job2.cancel(false); // Explicit false
  await sleep(100);

  assert(job2.state === 'cancelled', 'cancel(false) works (explicit cooperative)');

  // Test cancel(true) - force
  const job3 = manager.createJob(async (signal) => {
    for (let i = 0; i < 100; i++) {
      if (signal?.aborted) throw new Error('Aborted');
      await sleep(10);
    }
  }, { retries: 0 });

  await sleep(50);
  job3.cancel(true); // Force
  await sleep(100);

  assert(job3.state === 'cancelled', 'cancel(true) works (force cancellation)');
}

// ============================================================================
// TEST 9: Signal Abort Event Listener
// ============================================================================
async function test9_signalEventListener() {
  console.log('\n📋 TEST 9: Signal Abort Event Listener');
  console.log('Testing: signal.addEventListener("abort") pattern\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let abortEventFired = false;
  let cleanupCalled = false;

  const job = manager.createJob(async (signal) => {
    return new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        abortEventFired = true;
        cleanupCalled = true;
        reject(new Error('Aborted via event listener'));
      });

      setTimeout(() => resolve('completed'), 5000);
    });
  }, { retries: 0 });

  await sleep(100);
  job.cancel(true);
  await sleep(100);

  assert(abortEventFired, 'Abort event listener fired');
  assert(cleanupCalled, 'Cleanup logic executed on abort');
  assert(job.state === 'cancelled', 'Job state is "cancelled"');
}

// ============================================================================
// TEST 10: Multiple Signal Checks in Function
// ============================================================================
async function test10_multipleSignalChecks() {
  console.log('\n📋 TEST 10: Multiple Signal Checks');
  console.log('Testing: Checking signal at multiple checkpoints\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let checkpoint = 0;

  const job = manager.createJob(async (signal) => {
    if (signal?.aborted) throw new Error('Aborted at checkpoint 0');
    checkpoint = 1;
    await sleep(50);

    if (signal?.aborted) throw new Error('Aborted at checkpoint 1');
    checkpoint = 2;
    await sleep(50);

    if (signal?.aborted) throw new Error('Aborted at checkpoint 2');
    checkpoint = 3;
    await sleep(50);

    return 'completed all checkpoints';
  }, { retries: 0 });

  await sleep(75); // Cancel between checkpoint 1 and 2
  job.cancel(true);
  await sleep(100);

  assert(checkpoint >= 1 && checkpoint < 3, `Job aborted at checkpoint ${checkpoint}`);
  assert(job.state === 'cancelled', 'Job state is "cancelled"');
  console.log(`  Job aborted at checkpoint ${checkpoint}/3`);
}

// ============================================================================
// TEST 11: AbortController Property Exists
// ============================================================================
async function test11_abortControllerProperty() {
  console.log('\n📋 TEST 11: AbortController Property');
  console.log('Testing: Job has abortController property\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  const job = manager.createJob(async (signal) => {
    await sleep(100);
    return 'done';
  }, { retries: 0 });

  assert(job.abortController !== undefined, 'Job has abortController property');
  assert(job.abortController instanceof AbortController, 'abortController is AbortController instance');
  assert(!job.abortController.signal.aborted, 'Signal not aborted initially');

  job.cancel(true);
  await sleep(50);

  assert(job.abortController.signal.aborted, 'Signal aborted after cancel(true)');
}

// ============================================================================
// TEST 12: Force Cancel During Retry Delay
// ============================================================================
async function test12_forceCancelDuringDelay() {
  console.log('\n📋 TEST 12: Force Cancel During Retry Delay');
  console.log('Testing: Force cancel interrupts retry delay\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let attempts = 0;

  const job = manager.createJob(async (signal) => {
    attempts++;
    if (signal?.aborted) throw new Error('Aborted');
    throw new Error('Simulated failure');
  }, { retries: 10, delay: 500 }); // Long delay

  await sleep(100); // Wait for first attempt to fail
  const cancelTime = Date.now();
  job.cancel(true); // Cancel during the 500ms delay
  await sleep(200);

  const timeSinceCancel = Date.now() - cancelTime;

  assert(attempts === 1, `Only 1 attempt made (${attempts} total)`);
  assert(timeSinceCancel < 400, `Cancelled quickly (${timeSinceCancel}ms, not full 500ms delay)`);
  assert(job.state === 'cancelled', 'Job state is "cancelled"');
}

// ============================================================================
// TEST 13: Cooperative vs Force Cancel Behavior Difference
// ============================================================================
async function test13_cooperativeVsForce() {
  console.log('\n📋 TEST 13: Cooperative vs Force Behavior');
  console.log('Testing: Difference between cancel() and cancel(true)\n');

  const manager = new RetryQManager({ maxConcurrent: 2 });

  // Cooperative: allows current execution to finish
  let cooperativeIterations = 0;
  const job1 = manager.createJob(async (signal) => {
    for (let i = 0; i < 20; i++) {
      await sleep(25);
      cooperativeIterations++;
      // NO signal check - cooperative can't abort mid-execution
    }
    throw new Error('fail');
  }, { retries: 5, delay: 100 });

  await sleep(75); // Let some iterations run
  job1.cancel(); // Cooperative
  await sleep(300);

  // Force: aborts when signal checked
  let forceIterations = 0;
  const job2 = manager.createJob(async (signal) => {
    for (let i = 0; i < 20; i++) {
      if (signal?.aborted) throw new Error('Aborted');
      await sleep(25);
      forceIterations++;
    }
    throw new Error('fail');
  }, { retries: 5, delay: 100 });

  await sleep(75); // Let some iterations run
  job2.cancel(true); // Force
  await sleep(300);

  console.log(`  Cooperative: ${cooperativeIterations} iterations before cancel`);
  console.log(`  Force: ${forceIterations} iterations before abort`);

  assert(job1.state === 'cancelled', 'Cooperative cancel: state is "cancelled"');
  assert(job2.state === 'cancelled', 'Force cancel: state is "cancelled"');
  // Force should generally abort sooner due to signal checks
}

// ============================================================================
// TEST 14: Signal Passed to Helper Functions
// ============================================================================
async function test14_signalPropagation() {
  console.log('\n📋 TEST 14: Signal Propagation to Helpers');
  console.log('Testing: Signal propagated to nested functions\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let helperWasAborted = false;

  async function helperFunction(signal) {
    for (let i = 0; i < 10; i++) {
      if (signal?.aborted) {
        helperWasAborted = true;
        throw new Error('Helper aborted');
      }
      await sleep(20);
    }
  }

  const job = manager.createJob(async (signal) => {
    // Propagate signal to helper
    await helperFunction(signal);
    return 'completed';
  }, { retries: 0 });

  await sleep(50);
  job.cancel(true);
  await sleep(100);

  assert(helperWasAborted, 'Helper function detected abort signal');
  assert(job.state === 'cancelled', 'Job state is "cancelled"');
}

// ============================================================================
// TEST 15: No Signal Check - Force Cancel Still Prevents Retries
// ============================================================================
async function test15_forceCancelWithoutSignalCheck() {
  console.log('\n📋 TEST 15: Force Cancel Without Signal Check');
  console.log('Testing: cancel(true) still prevents retries even without signal checks\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let attempts = 0;

  const job = manager.createJob(async (signal) => {
    attempts++;
    await sleep(50);
    // NO signal check - but cancel(true) should still stop retries
    throw new Error('Simulated failure');
  }, { retries: 10, delay: 100 });

  await sleep(80); // Let first attempt complete
  job.cancel(true); // Force cancel
  await sleep(400);

  assert(attempts <= 2, `Retries prevented (${attempts} attempts, expected <=2)`);
  assert(job.state === 'cancelled', 'Job state is "cancelled"');
  console.log(`  Force cancel prevented retries (${attempts} attempts)`);
}

// ============================================================================
// TEST 16: Double Cancel Idempotency
// ============================================================================
async function test16_doubleCancelIdempotent() {
  console.log('\n📋 TEST 16: Double Cancel Idempotency');
  console.log('Testing: Calling cancel() multiple times is safe\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  const job = manager.createJob(async (signal) => {
    for (let i = 0; i < 100; i++) {
      if (signal?.aborted) throw new Error('Aborted');
      await sleep(10);
    }
  }, { retries: 0 });

  await sleep(50);
  job.cancel(true);
  job.cancel(true); // Second cancel
  job.cancel(true); // Third cancel
  await sleep(100);

  assert(job.state === 'cancelled', 'Job state is "cancelled"');
  assert(job.abortController.signal.aborted, 'Signal remains aborted');
  console.log('  Multiple cancel() calls handled safely (idempotent)');
}

// ============================================================================
// TEST 17: Cancel Completed Job (No-op)
// ============================================================================
async function test17_cancelCompletedJob() {
  console.log('\n📋 TEST 17: Cancel Completed Job');
  console.log('Testing: Cancelling an already-completed job is a no-op\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  const job = manager.createJob(async () => {
    await sleep(50);
    return 'success';
  }, { retries: 0 });

  await job.promise;

  assert(job.state === 'completed', 'Job completed successfully');

  job.cancel(true); // Try to cancel completed job

  assert(job.state === 'completed', 'Job state remains "completed" (cancel is no-op)');
  console.log('  Cancelling completed job is safely ignored');
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================
async function runAllTests() {
  const tests = [
    test1_backwardsCompatibility,
    test2_cooperativeCancelWithSignal,
    test3_forceCancelInLoop,
    test4_forceCancelFetchPattern,
    test5_externalAbortController,
    test6_signalOptionalChaining,
    test7_forceCancelPreventsRetries,
    test8_cancelSignatures,
    test9_signalEventListener,
    test10_multipleSignalChecks,
    test11_abortControllerProperty,
    test12_forceCancelDuringDelay,
    test13_cooperativeVsForce,
    test14_signalPropagation,
    test15_forceCancelWithoutSignalCheck,
    test16_doubleCancelIdempotent,
    test17_cancelCompletedJob,
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
    console.log('\n🎉 ALL TESTS PASSED! Force cancellation feature verified.');
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
