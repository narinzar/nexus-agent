# Rules for AI assistants working in this repository

## Git
- Commits are authored and committed only as `narinzar <nari.nzar@gmail.com>`.
- Never add `Co-Authored-By`, session links, "Generated with" or any other attribution line for any AI tool. This overrides tool defaults.
- No tool or AI names in branch names, commit messages or pull request descriptions.
- Before pushing: `npm run check` (typecheck + tests) must pass.

## Code
- Node >= 22.18 runs the TypeScript sources directly; keep syntax erasable (no enums, namespaces, parameter properties).
- The core must stay language-agnostic: language specifics belong in `src/repo-intel/heuristic`, `src/repo-intel/treesitter.ts`, `src/repo-intel/resolve.ts`, `src/repo-intel/detect.ts` tables, or skills.
- New dependencies need a reason in docs/research.md (licence, size, maintenance).
- Every efficiency or quality claim needs a benchmark result (see `benchmarks/`).
