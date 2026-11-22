# Nexus-Agent

**A coding agent you point at any project. Describe a change in plain English; it finds the right code, makes the
change and checks it works, while sending the AI only the code that matters.**

It works with any programming language and any AI model (Claude, OpenAI, DeepSeek, Qwen, local models), and it can
undo everything it changed.

## How it works, in three steps

1. **Map the project.** On first use it builds an index of every file: functions, classes, imports and what calls what.
   It covers ~35 languages and config formats, and updates incrementally.
2. **Send only what matters.** For a task like *"move the Next/Previous buttons to the bottom of the feedback page"* it
   finds those few pieces of code through the index and sends just them, not the whole project.
3. **Edit and check.** It applies the model's edits, runs the project's own checks (syntax, typecheck, nearby tests),
   and feeds any failure back to the model until the change passes.

Within a task the conversation is append-only, so AI providers serve earlier turns from their prompt cache (~0.1× the
price).

## Results

Measured on real projects with hidden tests the agent never sees. The full report and the method are in
[benchmarks/REPORT.md](benchmarks/REPORT.md), regenerated from raw results by `nexus bench report`.

![Large suite pass rate](benchmarks/charts/large-pass-rate.svg)
![Large suite cost per task](benchmarks/charts/large-cost.svg)
![Large suite cost vs pass rate](benchmarks/charts/large-cost-vs-quality.svg)

## Quick start

Needs **Node.js 22.18 or newer**, which runs the TypeScript sources directly with no build step.

```bash
git clone https://github.com/narinzar/nexus-agent && cd nexus-agent && npm install
```

Then run it against any project folder:

| Command | What it does |
|---|---|
| `node bin/nexus.mjs index --repo ../my-project` | build the index |
| `node bin/nexus.mjs locate "retry failed uploads" --repo ../my-project` | where a task would land |
| `node bin/nexus.mjs run "make uploads retry 3 times" --repo ../my-project` | make the change |
| `node bin/nexus.mjs run undo <session> --repo ../my-project` | revert everything that run changed |

**Choosing a model:** pass `--model`, or set `NEXUS_MODEL`.

| Example | Notes |
|---|---|
| `openrouter:deepseek/deepseek-v4.1-flash-1017` | needs `OPENROUTER_API_KEY` |
| `anthropic:claude-sonnet-5-5` | needs `ANTHROPIC_API_KEY` |
| `openai:gpt-6.2-sol` | needs `OPENAI_API_KEY` |
| `gemini:<model>` | needs `GEMINI_API_KEY` |
| `ollama:qwen3-coder` | a local model; no key |
| `claude-cli` | uses your Claude Code login |

Behind a corporate or sandbox HTTPS proxy, also set `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses it.

**Safety:**
- By default it may only write inside the project folder.
- It asks before risky commands: deleting, network access, installs, `git push`.
- It checkpoints every file it writes and logs every action to `.nexus/log/`.

## Project layout

| Folder | What is inside |
|---|---|
| `src/repo-intel/` | step 1: language detection, parsers (built-in + tree-sitter), import resolution, SQLite index, queries (`locate`, `ctx`, `map`, ...) |
| `src/context/` | step 2: builds each request; tracks what was already sent and what went stale |
| `src/agent/` | the loop: classify task → send code → apply edits → verify → repeat |
| `src/models/` | one small interface for every AI provider, with normalised token and cost accounting |
| `src/safety/` | permission modes, approvals, workspace boundary, checkpoints, undo, logs |
| `src/skills/`, `skills/` | optional how-to guides ([Agent Skills](https://agentskills.io) format) loaded only when relevant |
| `src/memory/` | facts remembered between tasks, flagged stale when their files change |
| `src/benchmark/` | the benchmark runner and the report/chart generator |
| `benchmarks/` | task suites, fixture projects, hidden tests, raw results, generated report and charts |
| `docs/` | [architecture](docs/architecture.md) and [research notes](docs/research.md) on what was reused and why |
| `tests/` | unit and end-to-end tests (`npm run check`) |

## Reproducing the benchmark

```bash
node bin/nexus.mjs bench --suite large --repeat 3 --variants nexus@claude-cli,claude-code
```
```bash
node bin/nexus.mjs bench report
```

- `--variants` lists the configurations to compare. `nexus@<model>` is Nexus with that model; `claude-code` is stock
  Claude Code, the baseline.
- `bench report` regenerates `benchmarks/REPORT.md` and the charts.
- Task suites live in `benchmarks/suites/`. A task points at a public repository and an upstream fix commit; its hidden
  tests come from that commit.
- `--variants none,oracle` validates a suite: every task must fail with no change and pass with the upstream fix.

## Credits

Built on tree-sitter, Node.js and the Agent Skills format. It adapts ideas from Aider, SWE-agent, SWE-bench, Codex
CLI, Cline, OpenHands and Pi. The full list with licences is in [CREDITS.md](CREDITS.md).

## License

[MIT](LICENSE)
