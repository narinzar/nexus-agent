# Using Nexus

A task-by-task guide. For why each step works the way it does, see [lanes.md](lanes.md) (starting, handover, lanes)
and [architecture.md](architecture.md) (the agent).

- [Install and choose a model](#install)
- [Start or hand over a project](#1-start-or-hand-over-a-project)
- [Make a change](#2-make-a-change)
- [Build in lanes](#3-build-in-lanes)
- [All commands](#all-commands)

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

Each change ends with a review round by default on non-trivial tasks (`--review auto`), and always in lanes. The review step costs about 20 to 25% more. It made no difference to Claude's pass rate (18/21 either way) and added
one pass for DeepSeek (14/21). Lanes always use it, because there it also guards an automatic merge.

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

Who decides what at each step: [lanes.md](lanes.md).

## All commands

`nexus help` prints the full list. The main ones:

| Command | What it does |
|---|---|
| `nexus new "<idea>" [--build] [--until-done] [--budget N]` | start a project from an idea |
| `nexus init` | prepare an existing repository for agents |
| `nexus handover [--fix]` | check the repository is ready for the next agent |
| `nexus env check` | check each environment's tools and sign-in |
| `nexus run "<task>"` | make one change |
| `nexus lanes run "<task>" ... [--merge]` | run several tasks in parallel lanes |
| `nexus lanes backlog [--until-done]` | work through `BACKLOG.md` |
| `nexus lanes`, `nexus lanes merge <id>`, `nexus lanes clean` | list, merge or clean up jobs |
| `nexus locate`, `nexus ctx`, `nexus refs`, `nexus impact` | query the code index |
| `nexus bench`, `nexus bench report` | run the benchmark, rebuild the report and charts |
