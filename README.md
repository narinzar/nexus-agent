# Nexus-Agent

A general-purpose software-engineering agent that works across languages, stacks and model providers. It treats a
repository as a queryable knowledge system, not as text to paste into prompts.

Status: **MVP**. Repository intelligence, context engine, agent runtime, providers, safety, skills, memory and
benchmarks work and are tested. See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and roadmap and
[docs/research.md](docs/research.md) for what was reused and why.

## Why

A simple UI change made by a general coding agent once cost ~1.9 M input tokens over ~32 model calls. The causes were
repeated instructions, re-sent tool output, whole-file reads and blind searching. Nexus avoids this as follows:

- It **indexes the repository once and incrementally**: symbols, imports, references, tests, build commands, for
  ~35 languages and config formats.
- It **seeds the first request with the exact code** the task touches: located through the graph, packed precisely,
  expanded along imports within a token budget.
- It **rebuilds every request from structured state**: a stable cacheable prefix plus a fresh suffix. Spans the model
  has already seen are deduplicated, and spans whose file changed are flagged stale.
- It **does deterministic work locally**: indexing, retrieval, edit application, verification and bookkeeping.

## Quick start

Requires **Node ≥ 22.18**, which runs the TypeScript sources directly with no build step.

```bash
npm install
```

The only optional dependency is the tree-sitter WASM grammars. Commands run on the current repository, or on another
one with `--repo <path>`.

| Example | What it does |
|---|---|
| `node bin/nexus.mjs index` | builds the incremental index in `.nexus/index.db` |
| `node bin/nexus.mjs doctor` | shows coverage per language and the available upgrades |
| `node bin/nexus.mjs map --budget 1500 auth` | ranked repository map, focused on "auth" |
| `node bin/nexus.mjs locate "retry failed uploads"` | the symbols a task most likely touches |
| `node bin/nexus.mjs ctx UploadService` | definition, users, uses, members, tests |
| `node bin/nexus.mjs run "Make uploads retry 3 times with backoff"` | runs the agent |
| `node bin/nexus.mjs run "..." --mode plan` | read-only investigation and plan |

## Models

Pass `--model provider:model`, or set `NEXUS_MODEL`.

| Spec | Notes |
|---|---|
| `anthropic:<model>` | `ANTHROPIC_API_KEY`; cache breakpoints on system + project prefix |
| `openai:<model>` | `OPENAI_API_KEY`; `prompt_cache_key` per session |
| `gemini:<model>` | `GEMINI_API_KEY`; implicit caching |
| `openrouter:<model>` | `OPENROUTER_API_KEY` |
| `ollama:<model>`, `lmstudio:<model>`, `vllm:<model>@<url>`, `compat:<model>@<url>` | any OpenAI-compatible server, including a LiteLLM proxy |
| `claude-cli[:<model>]` | uses a local Claude Code login; its own prompt, tools and MCP are switched off (~1.4 K fixed tokens) |

- **Usage:** normalised to uncached input, cache read, cache write, output and reasoning tokens.
- **Cost:** recorded only when the provider reports it, or from prices you configure. Nexus never guesses prices.
- **Protocol:** one text-action protocol for every model, so local models with weak tool calling still work. Native
  tool calling per provider is on the roadmap.

## Agent protocol

The model replies only with actions:
- `SEARCH/REPLACE` edit blocks;
- batched `@commands`: `@locate @find @ctx @refs @show @map @grep @run @test @check @skill @remember @ask @done`.

After every edit, Nexus re-indexes and verifies on its own: syntax via tree-sitter, unresolved imports, then the
typecheck and tests nearest the change. The results feed back into the next turn. A verified edit with nothing else
pending finishes the task in that same request.

## Safety

| Setting | Options |
|---|---|
| `--permission` | `read-only`, `workspace-write` (default), `full` |
| `--approve` | `always`, `risky` (default: deletes, network, installs, pushes, infrastructure), `never` |

- **Boundary:** writes outside the workspace and anything under `.git/` are refused.
- **Checkpoints:** every write is checkpointed, and `nexus run undo <session>` restores it.
- **Log:** every model call, command and write is logged to `.nexus/log/<session>.jsonl`.

## Skills and memory

- **Skills** use the open [Agent Skills](https://agentskills.io) `SKILL.md` format.
  - Read from `.nexus/skills`, `.agents/skills`, `.claude/skills`, `.github/skills`, `~/.nexus/skills`, plus the
    built-ins in `skills/`.
  - The catalogue (name + description) sits in the cacheable prefix. A skill body loads only on `@skill <name>`, and
    references and scripts only on demand.
  - Commands: `nexus skills list | show | new | install <path|git-url>`.
- **Memory** keeps facts and decisions with provenance: the source plus the hashes of the files they came from. A
  recalled fact is flagged *stale* when those files have changed. Project knowledge can also go in `.nexus/project.md`
  and AGENTS.md / CLAUDE.md, which are read as instructions.

## Benchmarks

```bash
node bin/nexus.mjs bench --retrieval
```
```bash
node bin/nexus.mjs bench --variants nexus,claude-code
```

- `--retrieval` is free and deterministic: it checks the first-request context against gold files.
- The second command runs real agents. Each task runs in an isolated copy; hidden acceptance tests are copied in after
  the agent finishes.
- Tasks: [bench/suite.json](bench/suite.json). Fixtures: Python, Go, Rust, C, Java, plus a real Next.js/TSX repository.
- Results: [bench/RESULTS.md](bench/RESULTS.md).

## Development

```bash
npm run check
```

This runs `tsc --noEmit` and `node --test`. The core stays language-agnostic: languages are added through tables in
`src/intel/`, extractors, or skills. See [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) for contribution rules.
