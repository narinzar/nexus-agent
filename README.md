# Nexus-Agent

**A coding agent you point at any project. Describe a change in plain English; it finds the right code, makes the
change and checks it works, while sending the AI only the code that matters.**

- Works with any programming language (~35 languages and config formats) and any AI model: Claude, OpenAI, Gemini,
  DeepSeek, Qwen, or a local model.
- Reviews its own change before finishing, and can undo everything it changed.
- Sets up any repository for agent work with one command, then runs several tasks in parallel, each in its own branch,
  accepted only when mechanical checks pass.

| On real repositories (7 tasks × 3 runs) | Passed | Cost per task |
|---|---|---|
| Nexus with Claude | **18/21** | $0.24 |
| Claude Code (baseline) | 17/21 | $0.39 |
| Nexus with DeepSeek | 13/21 | **$0.012** |

Full method and every run: [benchmarks/REPORT.md](benchmarks/REPORT.md).

## Install

Needs **Node.js 22.18 or newer**, which runs the TypeScript sources directly, with no build step.

```bash
git clone https://github.com/narinzar/nexus-agent
```
```bash
cd nexus-agent && npm install && npm link
```

`npm link` gives you a global `nexus` command. Without it, use `node bin/nexus.mjs` in place of `nexus`.

Then pick a model with `--model` or the `NEXUS_MODEL` variable:

| Model | Needs |
|---|---|
| `claude-cli` | your Claude Code login |
| `anthropic:claude-sonnet-5-5` | `ANTHROPIC_API_KEY` |
| `openai:gpt-6.2-sol` | `OPENAI_API_KEY` |
| `gemini:<model>` | `GEMINI_API_KEY` |
| `openrouter:deepseek/deepseek-v4.1-flash-1017` | `OPENROUTER_API_KEY` |
| `ollama:qwen3-coder` | a local model, no key |

Behind a corporate or sandbox HTTPS proxy, also set `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses it.

## Use it on one task

Run these inside your project, or add `--repo <path>`:

| Command | What it does |
|---|---|
| `nexus run "make uploads retry 3 times"` | make the change, check it, review it |
| `nexus run undo <session>` | revert everything that run changed |
| `nexus locate "retry failed uploads"` | show where a task would land, without changing anything |
| `nexus index` | build or refresh the code index (also done automatically) |

**Safety:**
- By default it writes only inside the project folder.
- It asks before risky commands: deleting, network access, installs, `git push`.
- It checkpoints every file it writes and logs every action to `.nexus/log/`.

## Use it as a software factory

Once per machine, set your identity. It is applied to your own agent files and to each clone, never written into
shared repositories:

```bash
nexus profile set git.name <your-name>
```
```bash
nexus profile set git.email <your-email>
```
```bash
nexus profile apply
```

Then, in any repository:

```bash
nexus init
```
```bash
nexus env check
```
```bash
nexus factory run "add X" "fix Y" "rename Z" --parallel 3 --merge
```

- **`nexus init`** detects the stack, commands and environments (local, Docker, WSL, PowerShell, Google Cloud, AWS
  Lambda, Modal). It writes:
  - one `AGENTS.md` that every coding agent reads;
  - thin pointers for Claude Code, Cursor, Copilot and Gemini;
  - matching skills.

  Your own text in those files is never touched.
- **`nexus env check`** checks each detected environment and prints the exact fix for anything missing.
- **`nexus factory run`** gives each task its own branch and worktree, and runs tasks that touch different code in
  parallel. Each change is reviewed, then accepted only when every mechanical gate passes:
  - typecheck, lint, tests and build;
  - no risky paths touched (CI, deploy, auth, dependencies, plus any you add);
  - it merges cleanly.

  It never pushes.

Who decides what, and every step, is in [docs/factory.md](docs/factory.md).

## How it works

1. **Map the project.** It indexes every file: functions, classes, imports and what calls what. The index updates
   incrementally.
2. **Send only what matters.** For a task like *"move the Next/Previous buttons to the bottom of the feedback page"* it
   finds those few pieces of code through the index and sends just them, not the whole project.
3. **Edit and check.** It applies the model's edits, runs the project's own checks (syntax, typecheck, nearby tests),
   and feeds any failure back to the model until the change passes.
4. **Review.** Before finishing a non-trivial change, the model reviews its own full diff against the task and fixes
   what it finds.

Within a task the conversation only grows at the end, so AI providers serve earlier turns from their prompt cache
(about a tenth of the price). Details: [docs/architecture.md](docs/architecture.md).

## Results

Measured on real projects with hidden tests the agent never sees. [benchmarks/REPORT.md](benchmarks/REPORT.md) is
regenerated from the raw results by `nexus bench report`.

![Large suite pass rate](benchmarks/charts/large-pass-rate.svg)
![Large suite cost per task](benchmarks/charts/large-cost.svg)
![Large suite cost vs pass rate](benchmarks/charts/large-cost-vs-quality.svg)

The review step costs about 20 to 25% more. It made no difference to Claude's pass rate (18/21 either way) and added
one pass for DeepSeek (14/21). The factory always uses it, because there it also guards an automatic merge.

To reproduce:

```bash
nexus bench --suite large --repeat 3 --variants nexus@claude-cli,claude-code
```
```bash
nexus bench report
```

More options are in [benchmarks/README.md](benchmarks/README.md).

## Project layout

| Path | What is inside |
|---|---|
| `bin/nexus.mjs` | the `nexus` command |
| `src/cli.ts` | command-line entry: parses commands and dispatches |
| `src/repo-intel/` | step 1: language detection, parsers (built-in and tree-sitter), import resolution, SQLite index, queries (`locate`, `ctx`, `map`, ...) |
| `src/context/` | step 2: builds each request; tracks what was already sent and what went stale |
| `src/agent/` | the loop: classify the task, send code, apply edits, verify, review, repeat |
| `src/models/` | one small interface for every AI provider, with normalised token and cost accounting |
| `src/safety/` | permission modes, approvals, workspace boundary, checkpoints, diffs, undo, logs |
| `src/skills/` | loads skills only when a task needs them |
| `src/memory/` | facts remembered between tasks, flagged stale when their files change |
| `src/factory/` | `init`, `validate`, environment checks, personal profile, parallel jobs with gates |
| `src/benchmark/` | the benchmark runner and the report and chart generator |
| `skills/` | how-to guides in the [Agent Skills](https://agentskills.io) format: debugging, testing, refactoring, code review, git, performance, and one per environment |
| `benchmarks/` | task suites, fixture projects, hidden tests, raw results, report and charts ([guide](benchmarks/README.md)) |
| `docs/` | [architecture](docs/architecture.md), [software factory](docs/factory.md), [research notes](docs/research.md) on what was reused and why |
| `tests/` | unit and end-to-end tests (`npm run check`) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm run check` must pass, the core stays language-agnostic, and
every efficiency or quality claim needs a benchmark result.

## Credits

Built on tree-sitter, Node.js and the Agent Skills format. It adapts ideas from Aider, SWE-agent, SWE-bench, Codex
CLI, Cline, OpenHands and Pi; the factory adapts ideas from agentskill, harness2, ponytail, archify, graphify and the
zazencodes software factory. The full list with licences is in [CREDITS.md](CREDITS.md).

## License

[MIT](LICENSE)
