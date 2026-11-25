# 2026-11-25: faster Claude calls, and new projects from one sentence

## Speed on real repositories

**Where the time went.** Logs of the 2026-11-22 runs (Nexus with Claude, 7 tasks × 3) showed 80% of each task's time
in model calls (51.6 s of 66 s) and 20% in commands, mostly test runs. More than half of the calls were short
navigation turns, which took at least 2.4 s each through the Claude CLI.

**Change.** The `claude-cli` adapter used to start one `claude` process per call, resuming the session each time. It
now keeps one process alive for the whole task and streams each new message to it. Measured on 16 short calls each
way, the average call took 1.69 s against 2.59 s.

**Ruled out.** Running checks in parallel. In lanes, warm typecheck, lint and test on a small project took 1.9 s
together against 2.1 s one after another. In the agent's own verification, Python projects have no typecheck step to
overlap with the tests. Neither was worth the added complexity.

**Result.** Both sides were measured on 2026-11-25. The Claude Code baseline was rerun because the 2026-11-22 run did
not record which model answered, and the CLI's default model may have changed since. Results now record it.

| Real repositories, 7 tasks × 3 runs | Claude Code | Nexus with Claude |
|---|---|---|
| Time per task | 69.5 s | 42.7 s |
| Cost per task | $0.411 | $0.204 |
| Input tokens per task | 520.9 K | 98.4 K |
| Model calls per task | 10.6 | 6.5 |
| Passed | 18/21 | 17/21 |

Not all of the drop from 66 s to 43 s is the adapter: this run also made fewer calls (6.5 against 8.3 per task) and
ran tests less often. Those vary between runs. The pass counts swapped compared with 2026-11-22 (18/21 against 17/21
then), which is within run-to-run variation.

## New projects from one sentence (`nexus bench new`)

Six ideas in five languages, each run through `nexus new --build --until-done` with DeepSeek V4.1 Flash and a $1
budget. Each result was then cloned fresh, set up from nothing, and checked with every check and the handover check.
Commits used a neutral benchmark identity. Results are in [REPORT.md](../REPORT.md#new-projects-from-one-sentence).

- 53 of 56 backlog items merged; 3 of 6 backlogs finished; the other 3 each have one item held for the owner.
- 5 of 6 fresh clones passed every check.
- $0.53 in total, $0.089 per project, about 10 minutes per project.

**What did not go well, in full:**

1. **First Rust attempt: a Nexus bug.** The agent wrote `/.nexus/` into the project's `.gitignore`. Git cannot
   un-ignore a file inside an ignored folder, so `.nexus/config.json` was never committed. Every job worktree lacked
   it and failed the handover gate, and all 9 items were held, after 34.6 minutes and $0.287. The handover check at
   the end of `nexus new` missed this, because it checked that the file existed, not that git tracked it.

   Fixed: `init` removes rules that hide the whole `.nexus` folder, `validate` flags an ignored config, and the
   handover check requires the config to be committed. The Rust idea was rerun with the fix. The first attempt is
   described here but not counted in the results file.
2. **Rust fresh-clone lint failure.** In the rerun, 7 of 8 items merged and every job's own lint gate passed. But the
   fresh clone's `make lint` failed inside clippy's own start-up probe ("failed to run `rustc` to learn about
   target-specific information"), before reading any project code. Later re-checks passed every check: the same clone
   with `nexus handover`, and a second fresh clone set up from nothing. The failure did not happen again. The result is
   reported as measured, a failure.
3. **Held items.** Three items were held for the owner:
   - TypeScript and Node: one each, after two failed attempts.
   - Rust: one at once, because it touched `.env.example`, which is on the escalation list.
