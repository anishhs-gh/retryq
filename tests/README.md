# @anishhs/retryq - Test Suite

This directory contains comprehensive tests for the @anishhs/retryq package. These tests verify all critical functionality, bug fixes, and new features.

**Note**: These tests are for developers and contributors. They are **NOT** published to npm (excluded via `.npmignore`).

---

## Test Files

### 1. verification.test.js

**Purpose**: Comprehensive verification of all critical bug fixes from v1.0.1

**Tests**: 8 test scenarios covering:
- ✅ Bounded memory growth (maxHistorySize + LRU eviction)
- ✅ Unhandled promise rejection protection
- ✅ Race condition prevention in queue processing
- ✅ Input validation with DoS protection
- ✅ Cancelled state preservation
- ✅ clearHistory() method functionality
- ✅ ID collision resistance (1000 concurrent jobs)
- ✅ Concurrency control under load

**Run**:
```bash
npm run test:verification
# or
node tests/verification.test.js
```

**What it tests**:
- Memory leaks are fixed
- Process won't crash from unhandled rejections
- Concurrency limits are enforced correctly
- Input validation prevents invalid configurations
- Cancellation state is preserved correctly

---

### 2. force-cancellation.test.js

**Purpose**: Verification of force cancellation feature added in v1.1.0

**Tests**: 17 test scenarios covering:
- ✅ Backwards compatibility (signal parameter optional)
- ✅ Cooperative cancellation behavior
- ✅ Force cancellation with AbortSignal
- ✅ Fetch/axios integration patterns
- ✅ External AbortController support
- ✅ Signal propagation to helper functions
- ✅ Multiple signal check patterns
- ✅ Cancel method signature variations
- ✅ Idempotent cancellation (double cancel)
- ✅ Event listener patterns
- ✅ Cooperative vs force behavior differences

**Run**:
```bash
npm run test:force-cancel
# or
node tests/force-cancellation.test.js
```

**What it tests**:
- Old code without signal parameter still works
- Force cancel (cancel(true)) aborts in-progress execution
- Signal integrates properly with fetch/axios
- External AbortControllers can be linked
- Signal checks work correctly throughout execution

---

### 3. cancellation-proof.test.js

**Purpose**: Proof that cancellation works correctly (answers "is cancellation working?")

**Tests**: 5 proof scenarios demonstrating:
- ✅ Cancellation prevents future retry attempts
- ✅ State is preserved as "cancelled" (not overwritten)
- ✅ No duplicate entries in state queues
- ✅ Cancellation interrupts retry delays quickly
- ✅ Double cancellation is safe (idempotent)

**Run**:
```bash
npm run test:cancellation
# or
node tests/cancellation-proof.test.js
```

**What it proves**:
- Cancellation IS working correctly
- Future retries are prevented
- State management is correct
- No memory leaks from duplicate entries
- Delays are interrupted promptly

---

## Running All Tests

Run the complete test suite:

```bash
npm test
```

This executes all three test files in sequence:
1. verification.test.js
2. force-cancellation.test.js
3. cancellation-proof.test.js

**Expected Results**:
- ✅ verification.test.js: 8/8 passing
- ✅ force-cancellation.test.js: 17/17 passing
- ✅ cancellation-proof.test.js: 5/5 passing
- **Total**: 30/30 passing tests

---

## Running Individual Test Files

```bash
# Run verification tests only
npm run test:verification

# Run force cancellation tests only
npm run test:force-cancel

# Run cancellation proof tests only
npm run test:cancellation

# Or run directly with node
node tests/verification.test.js
node tests/force-cancellation.test.js
node tests/cancellation-proof.test.js
```

---

## Test Requirements

**Prerequisites**:
- Node.js 14+ (for AbortController support)
- Package must be built first: `npm run build`

**Build before testing**:
```bash
npm run build  # Compile TypeScript
npm test       # Run tests
```

---

## Test Architecture

All tests use a simple custom test framework:
- No external testing dependencies (jest, mocha, etc.)
- Self-contained assertion system
- Clear pass/fail output with emojis
- Detailed error messages
- Exit code 0 on success, 1 on failure

**Test Structure**:
```javascript
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
```

---

## What These Tests Verify

### Critical Bug Fixes (v1.0.1)

1. **Memory Management**
   - Bounded history with maxHistorySize
   - LRU eviction of old jobs
   - Registry cleanup in all code paths

2. **Process Stability**
   - No unhandled promise rejections
   - Internal error handlers prevent crashes

3. **Concurrency Control**
   - maxConcurrent limits enforced
   - No race conditions in queue processing
   - Jobs wait for available slots

4. **Input Validation**
   - Negative values rejected
   - Excessive retries capped (DoS protection)
   - Clear error messages

5. **State Management**
   - Cancelled state preserved correctly
   - No duplicate queue entries
   - Proper state transitions

### Force Cancellation Feature (v1.1.0)

1. **Backwards Compatibility**
   - Old code without signal parameter works
   - Default cancellation remains cooperative

2. **AbortSignal Integration**
   - Signal passed to job functions
   - Force cancel aborts in-progress work
   - Works with fetch/axios/custom code

3. **External AbortController**
   - External signals can be linked
   - Bidirectional cancellation

4. **Signal Patterns**
   - Optional chaining (signal?.) safe
   - Event listeners work correctly
   - Helper function propagation

---

## Test Coverage

**Code Paths Tested**:
- ✅ Success path (job completes)
- ✅ Failure path (retries exhausted)
- ✅ Cancellation path (cooperative)
- ✅ Force cancellation path (AbortSignal)
- ✅ maxTime exceeded
- ✅ Input validation errors
- ✅ Unexpected errors (catch-all)

**Edge Cases Tested**:
- ✅ retries: 0 (execute once, no retries)
- ✅ Negative input values
- ✅ Excessive retries (> 100)
- ✅ Double cancellation
- ✅ Cancel completed jobs
- ✅ High concurrency (1000 jobs)
- ✅ Signal undefined (backwards compatibility)

**Integration Tested**:
- ✅ Fetch API pattern (AbortSignal)
- ✅ Axios pattern (AbortSignal)
- ✅ External AbortController
- ✅ Event listener patterns
- ✅ Helper function propagation

---

## Interpreting Test Output

### Success Output
```
✅ PASS: Bounded memory growth verified
✅ PASS: No unhandled rejections detected
...
🎉 ALL TESTS PASSED!
```

### Failure Output
```
❌ FAIL: Expected state to be "cancelled" but got "failed"
❌ Test failed with error: Assertion failed: ...
⚠️ SOME TESTS FAILED. Review output above.
```

### Exit Codes
- `0`: All tests passed (success)
- `1`: One or more tests failed (failure)

---

## CI/CD Integration

These tests can be integrated into CI/CD pipelines:

```yaml
# Example: GitHub Actions
- name: Build
  run: npm run build

- name: Run Tests
  run: npm test
```

```yaml
# Example: GitLab CI
test:
  script:
    - npm run build
    - npm test
```

---

## Adding New Tests

To add new tests:

1. **Create test function**:
   ```javascript
   async function testNewFeature() {
     console.log('\n📋 TEST: New Feature');
     const manager = new RetryQManager({ maxConcurrent: 1 });

     // Test code here

     assert(condition, 'Test description');
   }
   ```

2. **Add to test array**:
   ```javascript
   const tests = [
     test1_existingTest,
     testNewFeature, // Add here
   ];
   ```

3. **Run to verify**:
   ```bash
   node tests/your-test-file.test.js
   ```

---

## Troubleshooting

### Tests fail with "Cannot find module '../dist/index.js'"

**Solution**: Build the package first
```bash
npm run build
npm test
```

### Tests timeout or hang

**Problem**: Job might be stuck in infinite loop or retry

**Solution**: Check for:
- Proper cancellation in tests
- Reasonable retry counts
- Timeout values in job options

### Flaky tests (sometimes pass, sometimes fail)

**Problem**: Race conditions or timing issues

**Solution**:
- Increase sleep delays in tests
- Use longer retry delays
- Check for proper async/await usage

---

## Performance Notes

**Test Execution Time**:
- verification.test.js: ~2-3 seconds
- force-cancellation.test.js: ~3-5 seconds
- cancellation-proof.test.js: ~1-2 seconds
- **Total**: ~6-10 seconds for full suite

**Resource Usage**:
- Tests create up to 1000 concurrent jobs (ID collision test)
- Memory usage stays bounded (<50MB)
- No resource leaks (all jobs cleaned up)

---

## Version History

**v1.1.0** (2025-12-31):
- Added force-cancellation.test.js (17 tests)
- Tests for AbortSignal integration
- Tests for backwards compatibility

**v1.0.1** (2025-12-31):
- Created verification.test.js (8 tests)
- Created cancellation-proof.test.js (5 tests)
- Tests for all critical bug fixes

---

## Support

For questions about tests or to report test failures:
1. Check the [CHANGELOG.md](../CHANGELOG.md) for known issues
2. Review [reports/](../reports/) for detailed analysis
3. Open an issue on GitHub with test output

---

**Test Suite Version**: 1.1.0
**Last Updated**: 2025-12-31
**Status**: ✅ All tests passing (30/30)
