# Nexus-Agent architecture

Nexus-Agent starts a project from a description, or takes over an existing one, and builds it change by change in
parallel lanes, keeping the repository ready for the next agent. This document covers the agent at the centre of it,
the part that makes one change (step 2); starting, handing over and lanes are in [lanes.md](lanes.md). The agent is general-purpose. It is meant for any language and build system, works
with any model provider, and treats the repository as a queryable knowledge system instead of text to paste into
prompts.

Evidence for every reuse decision is in [research.md](research.md).

## Principles

1. **Language-agnostic core.** The core knows files, symbols, edges, commands and spans. Languages arrive through
   *intelligence providers* (heuristic → tree-sitter → SCIP/LSP), *build adapters* and *skills*. No core module
   imports anything language-specific.
2. **Deterministic first.** Detection, indexing, retrieval, slicing, edits, verification and bookkeeping are local
   code. The model is used to understand intent, decide and write code.
3. **Right context, not less context.** Every model call is assembled from typed state with a token budget per source.
   Context grows when evidence says it should; nothing is resent unless it changed.
4. **Provider independence.** One small internal interface. Adapters translate tool calls, caching and usage fields.
5. **Safe by default.** A permission mode (read-only, workspace-write, full) is combined with an approval policy, as in
   Codex. Everything is checkpointed and logged.
6. **Measured.** Each claim about efficiency or quality comes from the benchmark harness, with baselines.
7. **Small dependency surface.** Node ≥ 22.13 (runs `.ts` directly, has `node:sqlite`). Optional packages are loaded
   lazily: tree-sitter WASM grammars, MCP SDK, Playwright.

## Components

```
                ┌──────────────────────────── CLI / API / (later) ACP & editor clients ───────────────────────────┐
                │                                                                                                  │
 task ─► Agent Runtime ── classify ─► plan mode ──────────────────────────────┐                                    │
            │               (rules + graph signals; adaptive escalation)      │                                    │
            │                                                                 ▼                                    │
            │      Context Engine ◄── Repository Intelligence ◄── Intelligence providers (heuristic | tree-sitter | SCIP | LSP)
            │       │  task state, ledger,         (index, graph, locate,        │
            │       │  budgets, staleness           map, impact, check)          └── SQLite store (.nexus/index.db)
            │       ▼
            │   Model Provider Layer (anthropic | openai-compatible | gemini | claude-cli | mock | pi-ai later)
            │       │  usage → cached/uncached/output/reasoning/cost
            │       ▼
            └── Tool Runtime ── Safety layer (modes × approval, workspace boundary, command policy, checkpoints, log)
                   │   read/search/graph/edit/shell/git/build/test, MCP tools (lazy), skills scripts
                   ▼
            Skill Engine (agentskills.io SKILL.md, progressive)   Memory (facts with provenance + staleness)   Eval/Observability
```

| Component | Responsibility | Interface (stable) | Implementations |
|---|---|---|---|
| **Repository Intelligence** | Detect languages, build systems, entry points, tests, docs and commands; index symbols and edges incrementally; answer queries | `IntelProvider.extract(file, text) → Facts` plus a `precision` tag; `Repo.query(...)` | `heuristic` (≈20 languages, zero deps); `tree-sitter` (16 grammars bundled, more via the language pack); later `scip` (import `index.scip`) and `lsp` (stdio JSON-RPC) |
| **Context Engine** | Build each model request: a stable prefix (system, tools, project facts, skill catalogue), then a volatile suffix (task state, spans, results). Track what was inspected, at which file hash and token cost. Detect stale spans. Dedupe. Report tokens per source. | `Context.add(source, item)`, `Context.render(budget)`, `Ledger` | one implementation, policy-driven |
| **Model Provider Layer** | Send requests, normalise tool calls and usage, apply caching hints, select models | `Provider.complete(req) → {text, toolCalls, usage}` | `anthropic`, `openai` (any OpenAI-compatible: OpenAI, OpenRouter, Ollama, vLLM, LM Studio, llama.cpp, LiteLLM proxy), `gemini`, `claude-cli` (local Claude Code login), `mock` |
| **Agent Runtime** | Classify the task, choose a mode, run it, verify, report | `Agent.run(task, opts) → RunReport` | modes: `edit` (one call, no tools, search/replace), `loop` (tool calling or text actions), `plan` (read-only) |
| **Tool Runtime + Safety** | Execute tools under a permission mode and approval policy, within the workspace; checkpoint and log | `Tool{name, schema, risk, run}` | built-in tools; MCP tools later; skill scripts |
| **Skill Engine** | Discover, catalogue, activate, install and create skills (open SKILL.md standard) | `Skills.catalogue()`, `Skills.load(name)` | filesystem sources |
| **Memory** | Persist facts, decisions and preferences with provenance and staleness | `Memory.remember(fact, {source, files})`, `Memory.recall(query)` | SQLite tables |
| **Eval** | Benchmarks across languages: retrieval recall, edit success, tests, tokens (cached/uncached by source), calls, latency, cost; baselines | `nexus bench` | fixtures + task files |

### Repository intelligence in layers

| Layer | Cost | Precision | Coverage |
|---|---|---|---|
| L0 heuristic (built in) | 0 deps | definitions and spans reliable; references lexical (`~`) | Python, JS/TS, Go, Rust, Java, Kotlin, C#, C/C++, Swift, PHP, Ruby, Scala, Zig, Dart, Lua, shell, SQL, Terraform/HCL, Dockerfile, YAML/JSON/TOML config, Markdown, CSS |
| L1 tree-sitter (optional dep, WASM) | ~5 MB, no compiler | syntactic definitions, references, imports, calls | 16 bundled grammars; 371 via the language pack |
| L2 SCIP / LSP (when toolchains exist) | toolchain per language | semantic (compiler-accurate) | whatever indexers or servers are installed |
| Text search | ripgrep if present, else JS | exact | everything |

Each fact carries its precision. Queries merge facts and prefer the highest precision. `nexus doctor` reports which
upgrades are available, for example "gopls found: precise Go references available".

Graph nodes: file, symbol (function, class, method, type, const, component, test, route…), CSS rule, text key, doc
heading, config/manifest, command. Edges: IMPORTS, DEFINES, EXPORTS, CALLS, RENDERS, EXTENDS, REFERENCES, TESTS,
ROUTES_TO, USES_STYLE, USES_TEXT, DOCUMENTS. Each edge is marked confirmed or inferred. The store is SQLite. It is
incremental by mtime and hash, records each file's precision, and runs reverse queries through indexes. No graph
database is needed: the largest graphs we target (~10⁶ edges) are fine in SQLite.

### Context engine rules

- **Prefix / suffix split.** The prefix is identical across the calls of a session, so the provider can cache it. The
  suffix is rebuilt from task state every call. Anthropic gets breakpoints on the tools and the system prompt, OpenAI
  gets a `prompt_cache_key` per session, and Gemini relies on implicit caching.
- **Inspection ledger.** Each span shown carries `(file, lines, hash, tokens, source)`. Showing an unchanged span again
  becomes a one-line reference. If the file's hash changed, the span is marked stale and re-sent as a diff or new slice.
- **Budgets per source** (instructions, project facts, code, tool results, history), with per-request accounting of
  estimated tokens by source, compared against the provider's reported cached and uncached tokens.
- **History compaction.** Tool results older than the last N turns become one-line summaries (SWE-agent
  `Last5Observations`, OpenHands condensers). Decisions and discoveries are kept as structured task state, not chat.

### Safety

| Mode | Reads | Writes | Shell |
|---|---|---|---|
| `read-only` | workspace | none | read-only allowlist (`git status`, `ls`, `rg`, test listing) |
| `workspace-write` (default) | workspace | workspace only, checkpointed | allowlisted plus approval for the rest |
| `full` | any | any | any (still logged) |

Approval policy: `always`, `risky` (default: network, deletes, installs, git push, paths outside the workspace) or
`never`. Every tool call is appended to `.nexus/log/<session>.jsonl`. Every write is checkpointed, so `nexus undo`
restores it. Sandboxing processes with bubblewrap/seccomp, a container or a VM is a roadmap item; until then the
boundary is enforced in the tool layer.

## What is built (status 2026-11-24)

Everything below is implemented and tested (`npm run check`). End-to-end results are in
[benchmarks/REPORT.md](../benchmarks/REPORT.md). On focused changes in 6 languages (3 runs each), Nexus passed 27/27
with 37× fewer input tokens, 3.6× fewer requests and 81% lower cost than stock Claude Code with the same model. On
real-repository tasks it passed 18/21 against Claude Code's 17/21, at 38% lower cost.

1. `nexus index | status | doctor`: detection and a multi-language index (L0 + L1) in SQLite. Queries: `find`, `ctx`,
   `refs`, `show`, `map`, `locate`, `impact`.
2. Context engine: ledger, staleness and per-source token accounting.
3. Providers: `claude-cli` (live-tested), `anthropic`, `openai`-compatible, `gemini` (contract-tested with recorded
   fixtures), `mock`.
4. Agent runtime: `edit` mode (one call, search/replace, verify, repair) and `loop` mode (text-action protocol that
   works with any model), with escalation between them.
5. Safety: modes, approval policy, workspace boundary, checkpoints, execution log.
6. Skills: discovery and catalogue in agentskills.io format, activation by relevance, `skills new|install`.
7. Benchmarks: fixtures in several languages with gold files, tests and edit tasks; the earlier navigation-button task;
   a mini-swe-agent-style bash-only baseline and stock Claude Code as baselines.
8. Review: one self-review round of the full diff before a change is accepted (`--review auto|always|off`).
9. Starting and handing over: `nexus new` (spec, backlog, skeleton), `nexus init`, `nexus handover`, environment
   checks and a personal profile ([lanes.md](lanes.md)).
10. Lanes: parallel jobs in worktrees with mechanical gates, local merge, backlog rounds and `--until-done`
    ([lanes.md](lanes.md)).

## Roadmap after the MVP

| Stage | Adds | Exit criterion |
|---|---|---|
| 2 | Native tool calling per provider; Anthropic cache breakpoints; model router by task level, cost and failures | Same benchmark results with fewer tokens than text actions |
| 3 | SCIP importer; LSP client (definition, references, diagnostics, rename) | Measured recall gain on cross-file tasks in Go, Rust, Java, C# |
| 4 | MCP client with lazy tool exposure; skill install from git; memory recall in context | MCP tools usable without tool-list token blowup |
| 5 | Process sandbox (bubblewrap / container); ACP server so editors and UIs can drive Nexus | Untrusted repos runnable safely |
| 6 | Browser tool (playwright-cli + skill); GitHub workflows (PR, review, CI triage) | Web and CI tasks in the benchmark |
| 7 | Optional hybrid retrieval (BM25 + embeddings via sqlite-vec) | Kept only if it raises recall on vague queries in the benchmark |

## Trade-offs

| Decision | Benefit | Cost | Revisit when |
|---|---|---|---|
| TypeScript on Node, no build step | Largest ecosystem for agents, MCP, tree-sitter WASM and Playwright; one runtime; `node:sqlite` built in | Python-only tools (solidlsp, LiteLLM) must run as subprocesses or MCP servers | a Python library becomes essential |
| Own provider interface | Stable types; adapters are small; can wrap pi-ai or the AI SDK later | We maintain a few adapters and a price table | adapter upkeep exceeds the dependency risk |
| SQLite, no graph DB or vector DB | One file, transactional, fast reverse lookups | No graph query language (recursive CTEs suffice) | a measured need |
| Text-action loop before native tools | Works with every model, including local ones | Slightly more tokens than native tools | stage 2 |
| WASM tree-sitter instead of native | No compiler, works everywhere | ~2× slower parse (fine for incremental indexing) | indexing time dominates |
