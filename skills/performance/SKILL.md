---
name: performance
description: Measuring and improving speed or memory use in any language (profilers, benchmarks, algorithmic fixes, query optimisation, caching). Use when a task mentions slowness, timeouts, high CPU or memory, or optimisation.
---

# Performance

1. **Measure before changing.** Get a repeatable benchmark or timing command and a baseline number, with variance:
   run it several times.

   | Ecosystem | Tools |
   |---|---|
   | Python | `cProfile`/`py-spy` |
   | Go | `pprof` |
   | Rust | `cargo bench`/`perf` |
   | JVM | JFR/async-profiler |
   | Node | `--cpu-prof` |
   | .NET | `dotnet-trace` |
   | C/C++ | `perf`/`valgrind` |
   | SQL | `EXPLAIN (ANALYZE)` |

2. **Find the hot path** in the profile. Do not guess. Fix the largest cost first.
3. **Prefer algorithmic and I/O fixes over micro-tuning:**
   - remove N+1 queries and repeated work;
   - batch I/O;
   - add an index;
   - use the right data structure;
   - avoid copying large data;
   - cache with a clear invalidation rule.
4. **Keep behaviour identical.** Tests must still pass, and output must be byte-for-byte the same where that matters.
5. **Report** before/after numbers from the same benchmark, and note trade-offs (memory for speed, staleness for
   caching).
