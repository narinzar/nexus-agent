# Nexus-Agent

**Start a project from a description, or hand over one you already have. Nexus builds it change by change, many in
parallel, checks and reviews every change, and keeps the repository ready for whoever picks it up next, agent or
person.**

Describe the work in plain English. Nexus works in any programming language with any AI model, and sends the model
only the code a change needs, so each change costs less.

## How it works

| Step | Command | What happens |
|---|---|---|
| **1a. Start from scratch** | `nexus new "<what to build>"` | Writes `SPEC.md` (goal, scope, acceptance criteria, stack) and `BACKLOG.md` (small, testable items in build order), then a runnable skeleton with a script for every check, a passing test and a README. |
| **1b. Or hand over an existing repository** | `nexus init` | Detects the stack, commands and environments, then writes the instructions and skills every coding agent reads. Nexus, Claude Code, Codex, Cursor, Copilot and Gemini all follow the same rules. |
| **2. Make a change** | `nexus run "<task>"` | The agent finds the few pieces of code the task needs, edits them, runs the project's checks, reviews its own diff and fixes what it finds. |
| **3. Build in lanes** | `nexus lanes backlog` or `nexus lanes run "<task>" ...` | Runs step 2 for each task in its own branch. Tasks that touch different code run in parallel lanes; tasks that touch the same code share a lane and run in turn. Mechanical gates decide what is accepted, not the model. |

**Ready for handover, at every step.** `nexus handover` checks, mechanically, that the next agent or person can pick
the repository up cold:
- a command for every check, and they pass;
- tests exist;
- the README gives the commands;
- the agent instructions match the code;
- no secrets are tracked;
- everything is committed.

`nexus new` ends with this check. Every lanes job must keep the instructions true. The `build-for-handover` skill
tells every agent how to build so the check keeps passing.

**See it work:** [examples/](examples/README.md) has a Python CLI that Nexus built from one sentence (6 backlog items, 31
tests, about $0.06 with DeepSeek), with every commit and job decision.

**Results on real repositories** (7 tasks × 3 runs, hidden tests the agent never sees):

| Configuration | Passed | Cost per task |
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

Pick a model with `--model` or the `NEXUS_MODEL` variable:

| Model | Needs |
|---|---|
| `claude-cli` | your Claude Code login |
| `anthropic:claude-sonnet-5-5` | `ANTHROPIC_API_KEY` |
| `openai:gpt-6.2-sol` | `OPENAI_API_KEY` |
| `gemini:<model>` | `GEMINI_API_KEY` |
| `openrouter:deepseek/deepseek-v4.1-flash-1017` | `OPENROUTER_API_KEY` |
| `ollama:qwen3-coder` | a local model, no key |

Behind a corporate or sandbox HTTPS proxy, also set `NODE_USE_ENV_PROXY=1` so Node's `fetch` uses it.

## 1. Start or hand over a project

Once per machine, set your identity. It goes into your own agent files and into each clone's git config, never
into shared repositories:

```bash
nexus profile set git.name <your-name>
```
```bash
nexus profile set git.email <your-email>
```
```bash
nexus profile apply
```

**Starting from scratch:**

```bash
nexus new "a CLI that keeps a reading list in a JSON file: add, list, mark read, stats" --build --until-done --budget 5
```

- `nexus new` creates the folder, writes `SPEC.md` and `BACKLOG.md`, builds the skeleton, prepares it for agents (as
  `nexus init` below), commits it under your identity, and runs the handover check. If something fails, it gives the
  agent one round to repair it.
- With `--build`, it then builds the first backlog items in lanes (`--take 5` by default). Add `--until-done` to keep
  going until the backlog is finished (see step 3).

**Handing over a repository you already have:**

```bash
nexus init
```
```bash
nexus env check
```
```bash
nexus handover
```

- **`nexus init`** detects the stack, the setup, build, typecheck, lint and test commands, and the environments
  (local, Docker, WSL, PowerShell, Google Cloud, AWS Lambda, Modal). Each fact cites the file it came from. It writes:
  - one `AGENTS.md`, the canonical instructions;
  - thin pointers to it for Claude Code, Cursor, Copilot and Gemini;
  - matching skills;
  - `.nexus/config.json` with everything it decided, for you to edit.

  Your own text in those files is never touched, and running it twice changes nothing.
- **`nexus env check`** checks each environment's tools and sign-in, and prints the exact fix for anything missing.
- **`nexus handover`** shows what the next agent would trip over. `--fix` asks the agent to repair it and leaves the
  changes uncommitted for you to review.
- **`nexus validate`** later tells you when the instructions no longer match the repository.

## 2. Make a change

Run these inside the repository, or add `--repo <path>`:

| Command | What it does |
|---|---|
| `nexus run "make uploads retry 3 times"` | make the change, check it, review it |
| `nexus run undo <session>` | revert everything that run changed |
| `nexus locate "retry failed uploads"` | show where a task would land, without changing anything |

How the agent works:

1. **Map the project.** It indexes every file in ~35 languages and config formats: functions, classes, imports and
   what calls what. The index updates incrementally.
2. **Send only what matters.** For *"move the Next/Previous buttons to the bottom of the feedback page"* it finds
   those few pieces of code through the index and sends just them, not the whole project.
3. **Edit and check.** It applies the model's edits, runs the project's own checks (syntax, typecheck, nearby tests),
   and feeds any failure back to the model until the change passes.
4. **Review.** Before finishing a non-trivial change, the model reviews its full diff against the task and fixes what
   it finds.

Within a task the conversation only grows at the end, so providers serve earlier turns from their prompt cache, at
about a tenth of the price.

**Safety:**
- By default it writes only inside the project folder.
- It asks before risky commands: deleting, network access, installs, `git push`.
- It checkpoints every file it writes and logs every action to `.nexus/log/`.

## 3. Build in lanes

```bash
nexus lanes run "add X" "fix Y" "rename Z" --parallel 3 --merge
```

Or work through `BACKLOG.md` (written by `nexus new`, or by you as `- [ ]` lines):

```bash
nexus lanes backlog --until-done --budget 5
```

- Each round takes the next items (`--take 5`), runs them in lanes and merges what passes. Rounds repeat until the
  backlog is finished.
- Nexus records each item's outcome on its line. An item that did not land goes back to unchecked, with the job id,
  and is retried.
- After `--attempts` failed jobs (2 by default), an item is held for you. An item that touched a risky path is held at
  once, since a retry would hit the same gate. Either way, one hard item never stalls the rest.
- The loop also stops at `--budget` dollars or `--max-rounds` (20). It ends by listing what was merged, what is held
  for you, and what is still open.
- Without `--until-done`, `nexus lanes backlog` runs a single round.

1. **Plan:** tasks that would touch the same files share a lane and run one after another; lanes run in parallel.
2. **Isolate:** each task gets its own branch and worktree.
3. **Build:** step 2 runs there, with the review round always on.
4. **Gate:** a change is accepted only if every check passes:
   - typecheck, lint, tests and build pass;
   - the agent instructions still match the repository (the handover gate);
   - no risky path was touched (CI, deploy, auth, dependencies, plus any you add);
   - the commit carries your identity;
   - it merges cleanly.
5. **Decide:** each job ends **approved**, **needs-human** (with the reasons) or **failed**. The evidence is in
   `.nexus/jobs/<id>/decision.md`.
6. **Merge:** with `--merge`, approved jobs merge locally one at a time. **Nothing is ever pushed.**

Who decides what at each step: [docs/lanes.md](docs/lanes.md).

## Results

![Large suite pass rate](benchmarks/charts/large-pass-rate.svg)
![Large suite cost per task](benchmarks/charts/large-cost.svg)
![Large suite cost vs pass rate](benchmarks/charts/large-cost-vs-quality.svg)

The review step costs about 20 to 25% more. It made no difference to Claude's pass rate (18/21 either way) and added
one pass for DeepSeek (14/21). Lanes always use it, because there it also guards an automatic merge.

To reproduce:

```bash
nexus bench --suite large --repeat 3 --variants nexus@claude-cli,claude-code
```
```bash
nexus bench report
```

More options: [benchmarks/README.md](benchmarks/README.md).

## Project layout

| Path | What is inside |
|---|---|
| `bin/nexus.mjs` | the `nexus` command |
| `src/cli.ts` | command-line entry: parses commands and dispatches |
| `src/lanes/` | steps 1 and 3: `new`, `init`, `handover`, `validate`, environment checks, personal profile, parallel jobs with gates |
| `src/repo-intel/` | step 2, the map: language detection, parsers (built-in and tree-sitter), import resolution, SQLite index, queries (`locate`, `ctx`, `map`, ...) |
| `src/context/` | step 2, what to send: builds each request; tracks what was already sent and what went stale |
| `src/agent/` | step 2, the loop: classify the task, send code, apply edits, verify, review, repeat |
| `src/models/` | one small interface for every AI provider, with normalised token and cost accounting |
| `src/safety/` | permission modes, approvals, workspace boundary, checkpoints, diffs, undo, logs |
| `src/skills/`, `skills/` | how-to guides in the [Agent Skills](https://agentskills.io) format, loaded only when a task needs them: build for handover, debugging, testing, refactoring, code review, git, performance, and one per environment |
| `src/memory/` | facts remembered between tasks, flagged stale when their files change |
| `src/benchmark/`, `benchmarks/` | the benchmark runner, task suites, fixtures, hidden tests, raw results, report and charts ([guide](benchmarks/README.md)) |
| `examples/` | [readlist](examples/README.md): a Python CLI Nexus built from one sentence with `nexus new` and `--until-done`, with every job's decision record |
| `docs/` | [architecture](docs/architecture.md), [preparing a repository and lanes](docs/lanes.md), [research notes](docs/research.md) on what was reused and why |
| `tests/` | unit and end-to-end tests (`npm run check`) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `npm run check` must pass, the core stays language-agnostic, and
every efficiency or quality claim needs a benchmark result.

## Credits

Built on tree-sitter, Node.js and the Agent Skills format. The agent adapts ideas from Aider, SWE-agent, SWE-bench,
Codex CLI, Cline, OpenHands and Pi; preparation and lanes adapt ideas from agentskill, harness2, ponytail, archify, graphify
and the zazencodes software factory. The full list with licences is in [CREDITS.md](CREDITS.md).

## License

[MIT](LICENSE)
