---
name: code-review
description: Reviewing a diff or a module for correctness, security and maintainability, with concrete findings ranked by severity. Use when asked to review code, audit security, or check a change before merging.
---

# Code review

**Scope.** Review the change, `git diff` (`@run git diff`), plus the code it touches: `@ctx` on each modified
symbol, `@refs` for its callers, `@impact` for dependents and the tests that cover them. Start by stating in one
sentence what the change does and the load it assumes (one user, a batch job, a hot path).

**Look for, in order:**
1. **Correctness:** wrong conditions, off-by-one errors, null/None handling, error paths, concurrency, resource leaks,
   broken callers (`@refs`), migrations without rollback.
2. **Security:**
   - injection: SQL, shell, path traversal, template, deserialization;
   - authN/authZ checks on new endpoints;
   - secrets in code or logs;
   - unsafe defaults: CORS, TLS verification off, debug on;
   - dependency changes.
3. **Data and API compatibility:** schema, serialized fields, public signatures.
4. **Tests:** does a test exercise the change, and would it fail without it?
5. **Maintainability:** naming, duplication, dead code, complexity, consistency with neighbouring code.

**Evidence rule.** Every finding needs a concrete case: an input, a call sequence or a state that goes wrong. No case,
no finding. If you suspect something but cannot build a case, list it under "not checked", not as a finding.

**Report** in three groups (must fix, should fix, nice to have), each finding as: `severity | file:line | what is wrong | concrete failure scenario | suggested fix`. Order
by severity. Say plainly when you found nothing significant. Do not pad the review with style nits.
End with one line: what you did not read or could not check.
