---
name: debugging
description: Systematic procedure for finding the root cause of a failing test, crash, wrong output or flaky behaviour in any language. Use when a task reports a bug, an error message, a stack trace or a regression.
---

# Debugging

1. **Reproduce first.** Find or write the smallest command that shows the failure (a single test, a script, a request).
   Record the exact error and exit code. Without a reproduction, do not change code.
2. **Locate.** Map the stack trace or error text to symbols: `@locate <error words>`, `@ctx <function in trace>`,
   `@grep "<exact message>"`. Read the failing function and its callers, not whole files.
3. **Form one hypothesis at a time.** State what must be true if it is correct, then check it cheaply: a log line, an
   assertion, a focused test or `git log -L` / `git blame` on the suspect lines.
4. **Fix the cause, not the symptom.** Prefer the smallest change at the point where the wrong value is produced.
   Do not catch-and-ignore errors or loosen assertions to make tests pass.
5. **Prove it.** Run the reproduction, then the tests near the change (`@test`), then the wider suite if the change
   touched shared code (`@ctx` shows "NOTE shared").
6. **Prevent recurrence.** Add a regression test that fails before the fix and passes after it.

Flaky failures: run the test repeatedly. Look for time, ordering, randomness, shared state, network and concurrency.
Fix the nondeterminism; do not just add retries.
