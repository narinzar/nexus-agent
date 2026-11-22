# Research: what to reuse, adapt or avoid

Checked 2026-11-21 against each project's repository, manifest and licence file, or its npm/PyPI entry. "Unverified"
marks claims taken from secondary sources. Some sites (arXiv, some vendor docs, the GitHub API) were unreachable from
the research environment; repository files on raw.githubusercontent.com and the package registries were used instead.

## Verdicts at a glance

| Project | What it is | Licence | Verdict for Nexus |
|---|---|---|---|
| **tree-sitter / `@vscode/tree-sitter-wasm`** | Incremental parsers; WASM build with 16 grammars (bash, C#, C++, CSS, Go, INI, Java, JS, PHP, PowerShell, Python, regex, Ruby, Rust, TS, TSX) | MIT | **Reuse** (optional dependency). Verified: parses Python with definitions and references in ~18 ms, no compiler. |
| tree-sitter-language-pack (`@xberg-io/...-wasm`, PyPI) | 371 grammars, parsers downloaded on first use; tags queries for ~71 | MIT | **Plugin** for languages outside the 16 above. |
| Aider repo map | tree-sitter tags → def/ref graph → PageRank personalised by the chat → binary-searched into a token budget (1k default) | Apache-2.0 (queries carry upstream grammar licences) | **Adapt** the algorithm; already implemented as `map` and `locate`. Not usable as a library ("scripting API not officially supported"). |
| SCIP (`scip` CLI, `@scip-code/scip`, indexers for TS, Python, Java/Kotlin/Scala, Go, C/C++, Ruby, .NET, PHP, Rust via rust-analyzer, Dart) | Compiler-accurate definitions, references and relationships in a protobuf index | Apache-2.0 (scip-python, scip-php MIT) | **Optional precise layer.** Indexers re-index whole projects and need each toolchain, so SCIP suits batch or CI runs, not every edit. |
| LSP (any server: pyright, gopls, rust-analyzer, clangd, jdtls, terraform-ls, zls, godot) | Live definition, references, rename, diagnostics | servers vary | **Optional precise layer** through a small stdio JSON-RPC client of our own. |
| Serena | MCP server exposing LSP-backed symbol tools for 40+ languages | app GPL-3.0; its `solidlsp` library is MIT | **External MCP only** (never vendored). Its tool design (find_symbol, find_referencing_symbols, replace_symbol_body) informs ours. |
| multilspy | LSP client library, 12 languages | MIT | **Avoid**: low maintenance; superseded by solidlsp. |
| colbymchenry/codegraph | web-tree-sitter + `node:sqlite` code graph with MCP | MIT | **Adapt ideas**: closest to our design; confirms the Node + WASM + SQLite stack. |
| GitNexus | tree-sitter graph + embeddings | PolyForm Noncommercial | **Avoid** (licence). |
| code-graph-rag, codebase-memory-mcp | tree-sitter graphs in SQLite (+ optional Memgraph/Neo4j, embeddings) | MIT | **Reference designs**, or external MCP servers. |
| ast-grep (`@ast-grep/napi`, CLI) | Structural search and rewrite over tree-sitter, ~25 languages | MIT | **Optional plugin** for structural edits. |
| universal-ctags | Tag extraction, ~150 parsers | GPL-2.0 | **External CLI only.** |
| semgrep / opengrep | Static analysis rules | engine LGPL-2.1; Semgrep rules licence restrictive (unverified detail) | **External linter only.** |
| ripgrep | Text search | MIT/Unlicense | **Reuse when on PATH**, JS fallback otherwise. |
| zoekt, Kythe, stack-graphs | Code search / cross-references | Apache-2.0 / MIT | **Avoid as core** (infrastructure-heavy; stack-graphs unsupported). |
| **Pi (`@earendil-works/pi-ai`, `pi-agent-core`)** | Minimal TS agent harness; pi-ai unifies ~35 providers with streaming tool calls, usage `{input, output, cacheRead, cacheWrite, cost}`, cache retention | MIT | **Adapt now, optional adapter later.** Best provider/cost library found, but 65 releases in 6 months and a large API; Nexus keeps its own small provider interface so pi-ai can be plugged in without leaking its types. |
| Vercel AI SDK (`ai`, `@ai-sdk/*`) | Provider abstraction; usage with cache read/write tokens; no cost | Apache-2.0 | **Alternative adapter.** |
| LiteLLM | Python provider layer and proxy with a cost map | MIT (except `enterprise/`) | **External proxy only** (reachable through the OpenAI-compatible adapter). |
| OpenHands (now `software-agent-sdk` + "Agent Canvas") | Python agent SDK: event stream, condenser pipeline, risk-based confirmation, Docker/K8s workspaces, ACP | MIT | **Adapt**: condensers, confirmation policies, ACP for UIs. |
| SWE-agent / mini-swe-agent | Agent-computer interface research; mini = bash-only, ~190-line agent, stateless subprocess per step, >74% SWE-bench Verified claimed | MIT | **Adapt**: mini is our *baseline* agent design for evaluation; SWE-agent's lessons (windowed views, capped search, lint-gated edits, compact feedback) are in our tool design. |
| Aider (app) | Edit formats (whole, diff, udiff, architect/editor), lint+test loop | Apache-2.0 | **Adapt**: SEARCH/REPLACE edit format, lint/test feedback loop. |
| Cline | Plan/Act modes, approval per action, checkpoints, rules files, MCP | Apache-2.0 | **Adapt**: approval UX and checkpoints. SDK 0.2.x too young to depend on. |
| Continue | Extensible assistant | Apache-2.0 | **Avoid**: README says no longer maintained. |
| Roo Code | Modes (Code/Architect/Ask/Debug) | Apache-2.0 | **Avoid**: extension shut down; borrow the mode concept. |
| OpenAI Codex CLI | Rust agent; bubblewrap + seccomp sandbox; sandbox modes ReadOnly / WorkspaceWrite / FullAccess × approval policies; execpolicy; skills; compaction | Apache-2.0 | **Adapt** the sandbox × approval matrix (implemented as Nexus permission modes). |
| Goose (oi-kit) | Rust agent crates, 85+ providers, MCP, ACP | Apache-2.0 | **Watch**: oi-kit is alpha. |
| opencode | TS/Bun agent, client/server, per-agent permission profiles (build/plan) | MIT | **Adapt** permission profiles. |
| MCP (`@modelcontextprotocol/sdk`, spec 2025-11-25) | Standard tool/server protocol; stdio + Streamable HTTP | MIT | **Integrate** as a tool source with lazy (search-then-load) tool exposure, because full tool lists cost tens of thousands of tokens per request. |
| Agent Skills (agentskills.io, Apache-2.0) | Open SKILL.md standard: name + description loaded first, body on activation, resources on demand; adopted by Claude Code, Codex, Gemini CLI, Copilot, Cursor, opencode, Goose (adopter list partly unverified) | Apache-2.0 | **Integrate**: Nexus reads the standard format from `.nexus/skills`, `.agents/skills`, `.claude/skills`, `.github/skills` and `~/.nexus/skills`. |
| AGENTS.md (agents.md) | Plain-markdown project instructions read by many agents | open | **Integrate**: read as project instructions. |
| LangGraph | State graphs, checkpointing, human-in-the-loop | MIT | **Avoid for now**: a single agent loop does not need it; JSONL/SQLite checkpoints do the job. Revisit for durable multi-agent workflows. |
| Playwright MCP / playwright-cli | Browser automation from accessibility snapshots | Apache-2.0 | **Integrate later** as a skill-backed CLI tool (its README recommends CLI + skills over MCP to save tokens). |
| Embeddings (sqlite-vec, LanceDB) | Semantic retrieval | MIT/Apache-2.0 | **Optional, later, only if measured**: dense retrieval helps vague natural-language queries; identifiers and structure are better served by symbol search and BM25 (CoIR, CodeRAG-Bench: unverified here). |

## Provider facts that shape the design

**Prompt caching**

| Provider | How it works | Price | Rules that matter |
|---|---|---|---|
| Anthropic | Explicit `cache_control` breakpoints (max 4), in the order tools → system → messages | Writes 1.25× (5-minute TTL) or 2× (1-hour TTL); reads ~0.1× or less | Changing the tool definitions invalidates everything. |
| OpenAI | Automatic for prompts of 1,024+ tokens, matched on exact prefixes in 128-token steps; `prompt_cache_key` routes requests | Discounted reads, no write fee | — |
| Gemini | Implicit caching by default (2.5+); explicit `cachedContents` objects | Explicit caches billed per hour | — |

Design consequence: a **stable prefix** (tool definitions, system prompt, project facts, skill catalogue) followed by a
**volatile suffix** (task state, retrieved code, latest results), so all three providers can cache the prefix.

**Usage fields differ:**

| Provider | Cached input | Uncached input | Other fields |
|---|---|---|---|
| Anthropic | `cache_read_input_tokens` | `input_tokens` | `cache_creation_input_tokens` |
| OpenAI | `*_tokens_details.cached_tokens` | input minus `cached_tokens` | `reasoning_tokens` |
| Gemini | `cachedContentTokenCount` | `promptTokenCount` minus `cachedContentTokenCount` | `thoughtsTokenCount` |

Nexus normalises them to `{inputUncached, cacheRead, cacheWrite, output, reasoning, cost{…, source}}`.

**Local runtimes** all speak the OpenAI chat format, but tool calling depends on the server setup and the model:

| Runtime | Tool-calling setup |
|---|---|
| Ollama | Native support |
| llama.cpp | Needs `--jinja` |
| vLLM | Needs `--enable-auto-tool-choice --tool-call-parser` |
| LM Studio | Supported |

Nexus therefore supports both native tool calls and a plain-text action protocol (mini-swe-agent style) for models
that call tools poorly.
