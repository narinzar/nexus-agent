---
name: refactoring
description: Safe behaviour-preserving restructuring across files (rename, move, extract, change a signature, split a module) in any language. Use for refactors, cross-file renames and API changes that must keep every caller working.
---

# Refactoring

1. **Find every usage before changing anything.**
   - Use `@refs <symbol>` and `@ctx <symbol>`.
   - Also check strings, configs, reflection, templates, docs and tests: `@grep "<name>"`.
   - Edges marked `~` are inferred; confirm them.
2. **Keep the build green at each step.** Prefer small steps:
   1. add the new form;
   2. migrate the callers;
   3. remove the old form.
3. **Check the boundaries.**
   - Public API, exported symbols, serialized names (JSON fields, DB columns, routes, CLI flags) and plugin or FFI
     interfaces cannot change silently.
   - Keep a compatibility alias, or note the break explicitly.
4. **Moving code:** avoid import cycles and do not pull heavy or platform-specific dependencies into shared modules
   (e.g. server-only modules into client bundles, OS-specific code into portable crates).
5. **Verify:** typecheck or compile, then the tests for every touched module (`@test`), then a search for the old name
   (`@grep`) to confirm nothing is left.
6. **No behaviour changes mixed in.** If one is needed, make it a separate, explained edit.
