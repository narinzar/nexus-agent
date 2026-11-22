# Credits and resources used

Nexus-Agent stands on other people's work. This file lists what it uses directly, which ideas it adapted, and what the
benchmark runs on. Licences were checked against each project's own repository: see
[docs/research.md](docs/research.md) for the full evaluation, including projects we decided not to use and why.

## Used directly

| Resource | What for | Licence |
|---|---|---|
| [tree-sitter](https://tree-sitter.github.io/tree-sitter/) via [@vscode/tree-sitter-wasm](https://www.npmjs.com/package/@vscode/tree-sitter-wasm) | Syntax trees for 13 languages (optional dependency, WebAssembly, no compiler needed) | MIT |
| [Node.js](https://nodejs.org/) `node:sqlite`, `node:test`, type stripping | Index storage, tests, running TypeScript without a build | MIT |
| [TypeScript](https://www.typescriptlang.org/) | Type checking (development only) | Apache-2.0 |
| [Agent Skills](https://agentskills.io) open format (`SKILL.md`) | Skill files and progressive loading | Apache-2.0 (spec) |
| [AGENTS.md](https://agents.md) convention | Reading project instructions for agents | open |
| [ripgrep](https://github.com/BurntSushi/ripgrep) | Fast text search when installed | MIT / Unlicense |

## Ideas adapted (no code copied)

| Project | Idea |
|---|---|
| [Aider](https://github.com/Aider-AI/aider) (Apache-2.0) | Repository map: tags → reference graph → PageRank → token budget; SEARCH/REPLACE edit format; lint/test feedback loop |
| [SWE-agent](https://github.com/SWE-agent/SWE-agent) and [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) (MIT) | Compact tool output, capped views, edits gated by syntax checks; a minimal, model-agnostic text protocol |
| [SWE-bench](https://www.swebench.com/) | Benchmark method: real fix commits, hidden upstream tests, fail-before / pass-after validation |
| [OpenAI Codex CLI](https://github.com/openai/codex) (Apache-2.0) | Permission modes × approval policies |
| [Cline](https://github.com/cline/cline) (Apache-2.0) | Approval per risky action, checkpoints and undo |
| [OpenHands](https://github.com/OpenHands/software-agent-sdk) (MIT) | History compaction ("condensers"), risk-based confirmation |
| [Pi](https://github.com/badlogic/pi-mono) (MIT) | Normalised usage and cost accounting across providers |
| [Serena](https://github.com/oraios/serena) (GPL-3.0; no code used) | Symbol-level tools: find symbol, find references |
| [SCIP](https://github.com/sourcegraph/scip) (Apache-2.0) | Precision levels for code facts (heuristic / syntactic / semantic); planned import |
| [codegraph](https://github.com/colbymchenry/codegraph) (MIT) | Confirmation that WebAssembly tree-sitter + SQLite is a practical stack |

## Benchmark subjects

The large suite runs real upstream fix commits from these projects. They are cloned at run time and not vendored here:

| Project | Licence |
|---|---|
| [pallets/click](https://github.com/pallets/click) | BSD-3-Clause |
| [spf13/cobra](https://github.com/spf13/cobra) | Apache-2.0 |

The small-suite fixtures in `benchmarks/fixtures/` were written for this project (MIT).

## Models used in the published benchmark

These are reached through the Claude Code CLI and [OpenRouter](https://openrouter.ai):
- Anthropic Claude (CLI default model);
- DeepSeek V4.1 Flash;
- OpenAI GPT-6.2 Sol;
- Qwen 3.8;
- Meta Muse Spark Open.

Nexus-Agent is not affiliated with any of these providers.
