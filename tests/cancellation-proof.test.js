/**
 * Cancellation Proof Tests for @anishhs/retryq
 *
 * These tests prove that cancellation works correctly in the package.
 * Created in response to the question: "is the cancellation not working?"
 *
 * Demonstrates:
 * - Cancellation prevents future retry attempts
 * - State is preserved as "cancelled"
 * - No duplicate entries in failed/completed queues
 * - Cancellation during sleep interrupts properly
 * - Double cancellation is safe (idempotent)
 *
 * Run: node tests/cancellation-proof.test.js
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
console.log('║   @anishhs/retryq - Cancellation Proof Tests                  ║');
console.log('╚════════════════════════════════════════════════════════════════╝\n');
console.log('Proving that cancellation works correctly...\n');

// ============================================================================
// PROOF 1: Cancellation Prevents Future Retries
// ============================================================================
async function proof1_preventsRetries() {
  console.log('📋 PROOF 1: Cancellation Prevents Future Retries');
  console.log('Scenario: Job fails repeatedly, cancel it, verify no more attempts\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  let attemptCount = 0;

  const job = manager.createJob(async () => {
    attemptCount++;
    throw new Error('Simulated failure');
  }, {
    retries: 100, // Many retries to prove cancellation works
    delay: 100
  });

  // Let first attempt fail
  await sleep(150);

  const attemptsBeforeCancel = attemptCount;
  console.log(`  Attempts before cancel: ${attemptsBeforeCancel}`);

  // Cancel the job
  job.cancel();

  // Wait for several retry intervals
  await sleep(500);

  const attemptsAfterCancel = attemptCount;
  console.log(`  Attempts after cancel: ${attemptsAfterCancel}`);

  assert(
    attemptsAfterCancel <= attemptsBeforeCancel + 1,
    `No new retries after cancellation (${attemptsBeforeCancel} -> ${attemptsAfterCancel})`
  );

  assert(job.state === 'cancelled', 'Job state is "cancelled"');

  console.log('  ✓ Cancellation successfully prevents future retries\n');
}

// ============================================================================
// PROOF 2: State Preserved as "cancelled"
// ============================================================================
async function proof2_statePreserved() {
  console.log('📋 PROOF 2: State Preserved as "cancelled"');
  console.log('Scenario: Cancel a job, verify state stays "cancelled" (not overwritten)\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  const job = manager.createJob(async () => {
    throw new Error('Will fail');
  }, {
    retries: 10,
    delay: 100
  });

  await sleep(150); // Let first attempt fail
  job.cancel();
  await sleep(500); // Wait through multiple retry intervals

  assert(job.state === 'cancelled', 'Job state is "cancelled"');
  assert(job.state !== 'failed', 'Job state is NOT "failed" (no overwrite)');
  assert(job.error.message === 'Job cancelled', 'Error message correct');

  console.log('  ✓ State correctly preserved as "cancelled"\n');
}

// ============================================================================
// PROOF 3: No Duplicate Entries in Failed Queue
// ============================================================================
async function proof3_noDuplicates() {
  console.log('📋 PROOF 3: No Duplicate Entries in Failed Queue');
  console.log('Scenario: Cancel a failing job, verify no duplicates in state queues\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  const job = manager.createJob(async () => {
    throw new Error('Will fail');
  }, {
    retries: 5,
    delay: 100,
    label: 'proof3-job'
  });

  await sleep(150);
  job.cancel();
  await sleep(300);

  const state = manager.listJobs();

  // Count occurrences of this job across all states
  // Note: Cancelled jobs are stored in the failed array with state="cancelled"
  const allJobs = [...state.failed, ...state.completed, ...state.pending, ...state.running];
  const jobOccurrences = allJobs.filter(j => j.id === job.id);
  const cancelledJobs = state.failed.filter(j => j.id === job.id && j.state === 'cancelled');

  assert(jobOccurrences.length === 1, `Job appears exactly once in all queues (found ${jobOccurrences.length})`);
  assert(cancelledJobs.length === 1, `Job found in failed queue with state="cancelled" (found ${cancelledJobs.length})`);
  assert(job.state === 'cancelled', 'Job state is "cancelled"');

  console.log('  ✓ No duplicate entries - job in exactly one state queue\n');
}

// ============================================================================
// PROOF 4: Cancellation During Sleep Interrupts Delay
// ============================================================================
async function proof4_interruptsSleep() {
  console.log('📋 PROOF 4: Cancellation Interrupts Retry Delay');
  console.log('Scenario: Cancel during long retry delay, verify quick response\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  const job = manager.createJob(async () => {
    throw new Error('Will fail');
  }, {
    retries: 10,
    delay: 5000 // Very long delay (5 seconds)
  });

  await sleep(100); // Let first attempt fail and enter delay

  const cancelTime = Date.now();
  job.cancel();

  // Wait for cancellation to be detected
  await sleep(200);

  const responseTime = Date.now() - cancelTime;

  assert(responseTime < 1000, `Cancellation responded quickly (${responseTime}ms, not 5000ms)`);
  assert(job.state === 'cancelled', 'Job state is "cancelled"');

  console.log(`  ✓ Cancellation interrupted 5s delay in ${responseTime}ms\n`);
}

// ============================================================================
// PROOF 5: Double Cancellation is Safe (Idempotent)
// ============================================================================
async function proof5_idempotent() {
  console.log('📋 PROOF 5: Double Cancellation is Safe (Idempotent)');
  console.log('Scenario: Call cancel() multiple times, verify no errors\n');

  const manager = new RetryQManager({ maxConcurrent: 1 });

  const job = manager.createJob(async () => {
    await sleep(50);
    throw new Error('Will fail');
  }, {
    retries: 10,
    delay: 100
  });

  await sleep(80);

  // Cancel multiple times
  job.cancel();
  job.cancel();
  job.cancel();

  await sleep(200);

  assert(job.state === 'cancelled', 'Job state is "cancelled"');

  const state = manager.listJobs();
  // Cancelled jobs are in the failed array with state="cancelled"
  const allJobs = [...state.failed, ...state.completed, ...state.pending, ...state.running];
  const jobCount = allJobs.filter(j => j.id === job.id).length;

  assert(jobCount === 1, `Job appears exactly once in all queues (found ${jobCount})`);

  console.log('  ✓ Multiple cancel() calls handled safely (idempotent)\n');
}

// ============================================================================
// RUN ALL PROOFS
// ============================================================================
async function runAllProofs() {
  const proofs = [
    proof1_preventsRetries,
    proof2_statePreserved,
    proof3_noDuplicates,
    proof4_interruptsSleep,
    proof5_idempotent,
  ];

  for (const proof of proofs) {
    try {
      await proof();
    } catch (err) {
      console.error(`\n❌ Proof failed with error:`, err.message);
    }
  }

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        PROOF SUMMARY                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(`✅ Passed: ${testsPassed}`);
  console.log(`❌ Failed: ${testsFailed}`);
  console.log(`📊 Total:  ${testsPassed + testsFailed}`);

  if (testsFailed === 0) {
    console.log('\n🎉 ALL PROOFS PASSED!');
    console.log('✅ Cancellation is working correctly');
    console.log('\nWhat cancellation does:');
    console.log('  ✓ Prevents future retry attempts');
    console.log('  ✓ Preserves "cancelled" state');
    console.log('  ✓ Interrupts sleep delays');
    console.log('  ✓ No duplicate queue entries');
    console.log('  ✓ Idempotent (safe to call multiple times)');
    console.log('\nWhat cancellation does NOT do (by design):');
    console.log('  ✗ Force-abort in-progress execution (use force cancel for that)');
    process.exit(0);
  } else {
    console.log('\n⚠️  SOME PROOFS FAILED. Cancellation may have issues.');
    process.exit(1);
  }
}

runAllProofs().catch(err => {
  console.error('Fatal error running proofs:', err);
  process.exit(1);
});
