# Large-repo benchmark (real upstream repositories)

Run on 2026-11-22. Suite: [suite-large.json](suite-large.json).

**Tasks**
- Six are SWE-bench-style tasks from real upstream fix commits:
  - pallets/click (Python): CK1, CK2, CK3;
  - spf13/cobra (Go): CB1, CB2, CB3.
- The agent starts at the commit before the fix, with an issue-style prompt and no git remote.
- The fix commit's own tests are copied in afterwards and must pass.
- Each of these tasks was validated both ways: its tests fail without a change (`--variants none`) and pass with the
  upstream fix applied (`--variants oracle`).
- K2 is a level-3 feature on the real KADD Next.js repo: a new FAQ page in three languages, linked from the header.
  Its acceptance is a script (`bench/hidden/K2/accept.sh`) plus typecheck.

**Configurations:** Nexus with five models (Claude through the local CLI; four models through OpenRouter), and stock
Claude Code as the baseline. All costs are as reported by the CLI or by OpenRouter.

## Run 1: OpenRouter models capped at $0.15 per task

The cap was also applied, unintentionally, to Nexus+Claude; the baseline had a $3 cap.

| task | lang | level | variant | accept | requests | 1st input | total input | cache read | output | cost | time | gold edited |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CK1 | python | L2 | nexus@claude-cli | **fail** | 3 | 5.6K | 26K | 2.8K | 272 | $0.191 | 12s | 0% |
| CK1 | python | L2 | claude-code | **pass** | 6 | 39K | 258K | 241K | 67 | $0.238 | 53s | 100% |
| CK1 | python | L2 | nexus@openrouter:deepseek/deepseek-v4.1-flash-1017 | **pass** | 12 | 3.0K | 119K | 39K | 12K | $0.014 | 71s | 100% |
| CK1 | python | L2 | nexus@openrouter:qwen/qwen3.8-2.4t-a95b | **fail** | 7 | 3.0K | 40K | 0 | 13K | $0.158 | 75s | 0% |
| CK1 | python | L2 | nexus@openrouter:meta/muse-spark-open | **fail** | 6 | 3.0K | 18K | 11K | 1.7K | $0.018 | 7s | 0% |
| CK1 | python | L2 | nexus@openrouter:openai/gpt-6.2-sol | **pass** | 8 | 2.8K | 43K | 9.3K | 1.7K | $0.102 | 30s | 100% |
| CK2 | python | L2 | nexus@claude-cli | **fail** | 2 | 8.6K | 21K | 1.4K | 203 | $0.165 | 9s | 0% |
| CK2 | python | L2 | claude-code | **fail** | 14 | 39K | 729K | 698K | 179 | $0.525 | 73s | 100% |
| CK2 | python | L2 | nexus@openrouter:deepseek/deepseek-v4.1-flash-1017 | **fail** | 12 | 4.8K | 82K | 17K | 3.4K | $0.009 | 28s | 0% |
| CK2 | python | L2 | nexus@openrouter:qwen/qwen3.8-2.4t-a95b | **fail** | 6 | 4.7K | 58K | 0 | 18K | $0.222 | 81s | 0% |
| CK2 | python | L2 | nexus@openrouter:meta/muse-spark-open | **fail** | 6 | 4.6K | 54K | 16K | 1.8K | $0.057 | 36s | 100% |
| CK2 | python | L2 | nexus@openrouter:openai/gpt-6.2-sol | **fail** | 6 | 4.4K | 69K | 4.7K | 1.1K | $0.172 | 21s | 0% |
| CK3 | python | L3 | nexus@claude-cli | **pass** | 3 | 8.1K | 33K | 2.8K | 2.2K | $0.285 | 37s | 50% |
| CK3 | python | L3 | claude-code | **pass** | 15 | 39K | 743K | 717K | 246 | $0.515 | 120s | 100% |
| CK3 | python | L3 | nexus@openrouter:deepseek/deepseek-v4.1-flash-1017 | **pass** | 12 | 4.5K | 128K | 15K | 36K | $0.030 | 170s | 100% |
| CK3 | python | L3 | nexus@openrouter:qwen/qwen3.8-2.4t-a95b | **fail** | 5 | 4.6K | 49K | 38 | 12K | $0.171 | 66s | 0% |
| CK3 | python | L3 | nexus@openrouter:meta/muse-spark-open | **fail** | 6 | 4.5K | 27K | 18K | 634 | $0.017 | 9s | 0% |
| CK3 | python | L3 | nexus@openrouter:openai/gpt-6.2-sol | **pass** | 5 | 4.3K | 49K | 1.6K | 4.2K | $0.160 | 55s | 100% |
| CB1 | go | L2 | nexus@claude-cli | **pass** | 3 | 4.5K | 19K | 2.2K | 829 | $0.148 | 20s | 100% |
| CB1 | go | L2 | claude-code | **pass** | 7 | 39K | 306K | 289K | 619 | $0.250 | 33s | 100% |
| CB1 | go | L2 | nexus@openrouter:deepseek/deepseek-v4.1-flash-1017 | **pass** | 9 | 2.0K | 56K | 7.3K | 4.6K | $0.008 | 26s | 100% |
| CB1 | go | L2 | nexus@openrouter:qwen/qwen3.8-2.4t-a95b | **pass** | 5 | 2.1K | 33K | 0 | 18K | $0.174 | 90s | 100% |
| CB1 | go | L2 | nexus@openrouter:meta/muse-spark-open | **pass** | 6 | 2.1K | 21K | 6.3K | 2.2K | $0.028 | 18s | 100% |
| CB1 | go | L2 | nexus@openrouter:openai/gpt-6.2-sol | **pass** | 6 | 1.9K | 24K | 2.1K | 837 | $0.064 | 17s | 100% |
| CB2 | go | L2 | nexus@claude-cli | **pass** | 4 | 4.3K | 21K | 3.4K | 3.7K | $0.213 | 47s | 100% |
| CB2 | go | L2 | claude-code | **pass** | 13 | 39K | 633K | 609K | 214 | $0.463 | 72s | 100% |
| CB2 | go | L2 | nexus@openrouter:deepseek/deepseek-v4.1-flash-1017 | **fail** | 12 | 1.8K | 170K | 6.8K | 19K | $0.022 | 86s | 0% |
| CB2 | go | L2 | nexus@openrouter:qwen/qwen3.8-2.4t-a95b | **fail** | 7 | 1.9K | 66K | 0 | 18K | $0.239 | 100s | 0% |
| CB2 | go | L2 | nexus@openrouter:meta/muse-spark-open | **fail** | 10 | 1.8K | 71K | 8.3K | 4.4K | $0.099 | 33s | 50% |
| CB2 | go | L2 | nexus@openrouter:openai/gpt-6.2-sol | **fail** | 7 | 1.7K | 58K | 2.7K | 2.1K | $0.161 | 29s | 0% |
| CB3 | go | L2 | nexus@claude-cli | **fail** | 3 | 4.4K | 22K | 2.2K | 381 | $0.165 | 13s | 0% |
| CB3 | go | L2 | claude-code | **pass** | 11 | 39K | 510K | 489K | 204 | $0.380 | 58s | 100% |
| CB3 | go | L2 | nexus@openrouter:deepseek/deepseek-v4.1-flash-1017 | **pass** | 12 | 1.9K | 144K | 16K | 14K | $0.023 | 69s | 100% |
| CB3 | go | L2 | nexus@openrouter:qwen/qwen3.8-2.4t-a95b | **pass** | 5 | 1.9K | 39K | 0 | 21K | $0.205 | 109s | 100% |
| CB3 | go | L2 | nexus@openrouter:meta/muse-spark-open | **fail** | 7 | 1.9K | 78K | 4.5K | 2.6K | $0.104 | 30s | 100% |
| CB3 | go | L2 | nexus@openrouter:openai/gpt-6.2-sol | **pass** | 9 | 1.7K | 62K | 4.1K | 1.8K | $0.163 | 28s | 100% |
| K2 | tsx | L3 | nexus@claude-cli | **pass** | 3 | 7.3K | 44K | 5.3K | 4.6K | $0.400 | 49s | 100% |
| K2 | tsx | L3 | claude-code | **pass** | 12 | 40K | 636K | 604K | 88 | $0.503 | 95s | 100% |
| K2 | tsx | L3 | nexus@openrouter:deepseek/deepseek-v4.1-flash-1017 | **pass** | 18 | 3.7K | 292K | 34K | 15K | $0.033 | 81s | 100% |
| K2 | tsx | L3 | nexus@openrouter:qwen/qwen3.8-2.4t-a95b | **fail** | 5 | 4.0K | 77K | 0 | 5.0K | $0.185 | 37s | 0% |
| K2 | tsx | L3 | nexus@openrouter:meta/muse-spark-open | **fail** | 7 | 3.6K | 16K | 7.7K | 871 | $0.016 | 8s | 0% |
| K2 | tsx | L3 | nexus@openrouter:openai/gpt-6.2-sol | **pass** | 3 | 3.5K | 22K | 0 | 1.8K | $0.072 | 22s | 100% |
| **all** | | | nexus@claude-cli | **4/7** | 21 | | 185K | 20K | 12K | $1.57 | 186s | |
| **all** | | | claude-code | **6/7** | 78 | | 3815K | 3647K | 1.6K | $2.87 | 503s | |
| **all** | | | nexus@openrouter:deepseek/deepseek-v4.1-flash-1017 | **5/7** | 87 | | 991K | 136K | 104K | $0.14 | 531s | |
| **all** | | | nexus@openrouter:qwen/qwen3.8-2.4t-a95b | **2/7** | 40 | | 362K | 38 | 105K | $1.35 | 558s | |
| **all** | | | nexus@openrouter:meta/muse-spark-open | **1/7** | 48 | | 286K | 72K | 14K | $0.34 | 141s | |
| **all** | | | nexus@openrouter:openai/gpt-6.2-sol | **5/7** | 44 | | 327K | 25K | 13K | $0.89 | 202s | |

## Run 2: Nexus + Claude with the same $3 cap as the baseline

| task | lang | level | variant | accept | requests | 1st input | total input | cache read | output | cost | time | gold edited |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CK1 | python | L2 | nexus@claude-cli | **pass** | 12 | 5.6K | 126K | 20K | 2.0K | $0.892 | 69s | 100% |
| CK2 | python | L2 | nexus@claude-cli | **fail** | 12 | 8.6K | 175K | 23K | 2.8K | $1.275 | 63s | 0% |
| CK3 | python | L3 | nexus@claude-cli | **pass** | 12 | 8.1K | 179K | 23K | 9.0K | $1.439 | 189s | 50% |
| CB1 | go | L2 | nexus@claude-cli | **pass** | 3 | 4.5K | 17K | 5.8K | 1.2K | $0.113 | 24s | 100% |
| CB2 | go | L2 | nexus@claude-cli | **fail** | 6 | 4.3K | 40K | 9.0K | 3.4K | $0.314 | 48s | 100% |
| CB3 | go | L2 | nexus@claude-cli | **pass** | 7 | 4.4K | 72K | 10K | 4.2K | $0.578 | 57s | 100% |
| K2 | tsx | L3 | nexus@claude-cli | **pass** | 3 | 7.3K | 37K | 9.9K | 4.9K | $0.315 | 52s | 100% |
| **all** | | | nexus@claude-cli | **5/7** | 55 | | 646K | 101K | 27K | $4.93 | 501s | |

## Findings

1. **Tokens are not cost.**
   - Nexus + Claude used 6× fewer input tokens than stock Claude Code (646 K vs 3.8 M).
   - It still cost more ($4.93 vs $2.87), at a similar pass rate (5/7 vs 6/7).
   - The reason: Claude Code's growing conversation is ~95 % cache reads, billed at ~0.1×. Nexus rebuilds the turn
     suffix every request, so most of its input is written to the cache (billed 1.25–2×) or read uncached.
   - On multi-turn tasks, stateless rebuilding loses to append-only history. It wins only on single-shot tasks (the
     small suite: 1 request, 38× fewer tokens, 3.9× cheaper).
   - Fix: make the suffix append-only within a session (observations appended, never re-rendered), with occasional
     compaction, so the provider caches the whole conversation.
2. **Turn limits:** Nexus + Claude hit the 12-turn limit on CK1–CK3. click's tasks are bigger than the rule-based
   classifier assumed (level 1–2 → 12 turns).
3. **Model results**

   | Model | Passed | Cost (7 tasks, $0.15 cap) | Note |
   |---|---|---|---|
   | DeepSeek V4.1 Flash | 5/7 | $0.14 | ~20× cheaper than the baseline; many requests and long outputs |
   | GPT-6.2 Sol | 5/7 | $0.89 | several passes despite hitting the cap |
   | Qwen 3.8 flagship | 2/7 | $1.35 | very long reasoning outputs (105 K output tokens); hit the cap |
   | Meta Muse Spark Open | 1/7 | $0.34 | usually "too many failed steps": it does not follow the SEARCH/REPLACE text protocol reliably |

   Native tool calling (roadmap stage 2) should help Muse and Qwen.
4. **CK2 failed for every configuration, including Claude Code.** It is the hardest task in the suite: it spans
   `testing.py` and the colour handling used by prompt, confirm and the pager.
5. **Variance is real:** Nexus + Claude passed CB2 in run 1 and failed it in run 2. A single run per task is not enough
   to rank close configurations.

## Run 3: append-only conversation (the fix for finding 1)

**What changed**
- Later turns now send only what is new; earlier turns are resent unchanged, so the provider serves them from cache.
- The Claude CLI resumes one session per conversation.
- Level 1–2 tasks get 20 turns.

**Accounting bug found and fixed:** a resumed CLI session reports a *cumulative* cost on every call, so summing per
call overcounted (the raw run showed $7.44). The adapter now records the per-call difference. The costs below are
recomputed from the per-turn logs. Runs 1 and 2 started a fresh CLI process per call, so their costs were already
correct.

| task | accept | requests | total input | cache read | true cost |
|---|---|---|---|---|---|
| CK1 | **pass** | 9 | 105 K | 94 K | $0.156 |
| CK2 | fail (hard: failed for every configuration) | 12 | 291 K | 260 K | $0.380 |
| CK3 | **pass** | 8 | 155 K | 139 K | $0.222 |
| CB1 | fail (see below) | 4 | 36 K | 28 K | $0.106 |
| CB2 | fail | 8 | 89 K | 75 K | $0.177 |
| CB3 | **pass** | 11 | 207 K | 180 K | $0.312 |
| K2 | **pass** | 3 | 34 K | 26 K | $0.157 |
| **all** | **4/7** | 55 | 917 K | 802 K (87 %) | **$1.51** |

CB1 failed only because the agent added its own test, `TestNoDuplicateArgs`, in a new file. The hidden upstream file
declares the same name, so the Go package no longer compiled. The implementation itself was correct. Under
SWE-bench-style rules this still counts as a failure.

**Summary, Claude model**

| Configuration | Passed | Input tokens | Cost |
|---|---|---|---|
| Stock Claude Code | 6/7 | 3.8 M | $2.87 |
| Nexus, rebuilt context (run 2) | 5/7 | 646 K | $4.93 |
| **Nexus, append-only (run 3)** | **4/7** | **917 K** | **$1.51** |

The cost problem is fixed: Nexus is now 1.9× cheaper than stock Claude Code on real multi-step tasks, and 3.3× cheaper
than before. Correctness still trails the baseline on these tasks. That is now the gap to close, and it needs repeated
runs to measure reliably.
