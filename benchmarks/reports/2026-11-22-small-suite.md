# Benchmark results

Run on 2026-11-22. Command: `node bin/nexus.mjs bench --variants nexus,claude-code`.

**Setup**
- Both variants use the **same model**: the Claude CLI's default, Nexus through its `claude-cli` provider.
- Each run is an isolated copy of the task repository.
- Acceptance tests are hidden: they are copied in after the agent finishes, then the task's test command runs.
- Costs are as reported by the CLI.

**The variants**
- **nexus:** `nexus run --approve never`.
- **claude-code:** stock headless Claude Code (`claude -p`, default configuration, Bash/Read/Edit/Write/Grep/Glob
  allowed). This is the baseline workflow from the original token audit.

## End-to-end (9 tasks, 6 languages)

| task | lang | level | variant | accept | requests | 1st input | total input | cache read | output | cost | time | gold edited |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | python | L1 | nexus | **pass** | 1 | 3.6K | 3.6K | 1.1K | 126 | $0.023 | 4s | 100% |
| P1 | python | L1 | claude-code | **pass** | 5 | 39K | 197K | 188K | 172 | $0.127 | 9s | 100% |
| P2 | python | L2 | nexus | **pass** | 4 | 2.9K | 13K | 5.3K | 924 | $0.081 | 19s | 100% |
| P2 | python | L2 | claude-code | **pass** | 4 | 39K | 160K | 149K | 280 | $0.149 | 14s | 100% |
| P3 | python | L3 | nexus | **pass** | 2 | 3.1K | 7.3K | 3.3K | 572 | $0.044 | 10s | 100% |
| P3 | python | L3 | claude-code | **pass** | 3 | 39K | 118K | 109K | 198 | $0.110 | 7s | 100% |
| G1 | go | L2 | nexus | **pass** | 1 | 3.8K | 3.8K | 1.1K | 695 | $0.035 | 8s | 100% |
| G1 | go | L2 | claude-code | **pass** | 6 | 39K | 243K | 230K | 56 | $0.205 | 27s | 100% |
| G2 | go | L1 | nexus | **pass** | 1 | 3.8K | 3.8K | 1.1K | 242 | $0.026 | 5s | 100% |
| G2 | go | L1 | claude-code | **pass** | 9 | 39K | 368K | 354K | 413 | $0.221 | 24s | 100% |
| R1 | rust | L2 | nexus | **pass** | 1 | 4.3K | 4.3K | 0 | 606 | $0.047 | 7s | 100% |
| R1 | rust | L2 | claude-code | **pass** | 4 | 39K | 164K | 151K | 42 | $0.170 | 16s | 100% |
| C1 | c | L1 | nexus | **pass** | 1 | 3.5K | 3.5K | 1.1K | 119 | $0.022 | 4s | 100% |
| C1 | c | L1 | claude-code | **pass** | 4 | 39K | 161K | 148K | 317 | $0.161 | 16s | 100% |
| J1 | java | L1 | nexus | **pass** | 1 | 3.3K | 3.3K | 0 | 180 | $0.030 | 5s | 100% |
| J1 | java | L1 | claude-code | **pass** | 4 | 39K | 161K | 148K | 319 | $0.157 | 13s | 100% |
| K1 | tsx | L1 | nexus | **pass** | 1 | 10K | 10K | 0 | 1.1K | $0.103 | 14s | 100% |
| K1 | tsx | L1 | claude-code | **pass** | 9 | 40K | 432K | 409K | 122 | $0.316 | 27s | 100% |
| **all** | | | nexus | **9/9** | 13 | | 53K | 13K | 4.5K | $0.41 | 76s | |
| **all** | | | claude-code | **9/9** | 48 | | 2005K | 1885K | 1.9K | $1.61 | 153s | |

| Total | Nexus | Claude Code | Ratio |
|---|---|---|---|
| Hidden acceptance tests passed | 9/9 | 9/9 | same |
| Model requests | 13 | 48 | 3.7× fewer |
| Input tokens (all requests) | 53 K | 2,005 K | 38× fewer |
| Output tokens | 4.5 K | 1.9 K | Nexus writes more: edits are full SEARCH/REPLACE blocks, and the model's reasoning text counts as output |
| Cost | $0.41 | $1.61 | 3.9× cheaper |
| Wall time | 76 s | 153 s | 2× faster |

## Task notes

- **K1** is the original navigation-button task: the real Next.js repository at the commit before the fix.
  - Nexus took one request (10 K input) and produced the same, correct patch as Claude Code: buttons moved below the
    carousel, reusing the existing `.vnav.static` helper.
  - Claude Code took 9 requests and 432 K input.
- **P2:** Nexus used 4 requests because the model chose to add boundary tests for the new discount tier. That is extra
  work, not waste.
- **Cost:** the cost ratio (3.9×) is smaller than the token ratio (38×), for two reasons:
  - most of Claude Code's input is cache reads, which are cheap;
  - Nexus's single-shot requests pay the cache-write premium on their small prefix.

  With an API provider and a session reused across tasks, Nexus's prefix would also be read from cache.

## Retrieval (deterministic, no model)

Command: `node bin/nexus.mjs bench --retrieval`. It reports whether the files that must change are inside the
first request's context:
- 13/13 gold files are found;
- the first-request context is 119–3.3 K tokens, excluding the stable prefix;
- indexing takes 10–260 ms per repository.

## Limits of this evidence

- Single run per task, so there is no variance estimate. Rerun to see spread.
- Fixtures P1–J1 are small projects written for this benchmark. K1 is a real repository. Level 3–4 tasks on large
  real repositories are the next benchmark to add.
- One model family. The protocol is provider-independent, but quality with other or smaller models (Ollama, vLLM) is
  unmeasured.
