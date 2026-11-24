# Starting, handing over and building in lanes

Nexus takes a project from a description, or from an existing repository, to checked, reviewed, merged work, and keeps
it ready for whoever picks it up next. Three steps:
1. **Start or hand over:** `nexus new` for a new project, `nexus init` for an existing one.
2. **Make a change:** `nexus run`, the agent described in [architecture.md](architecture.md).
3. **Build in lanes:** `nexus lanes backlog` or `nexus lanes run`.

This guide covers steps 1 and 3, and the handover check that runs through all of them.

## Once per machine

```bash
nexus profile set git.name <your-name>
```
```bash
nexus profile set git.email <your-email>
```
```bash
nexus profile apply
```

## A new project, start to finish

```bash
nexus new "<what to build>" --build
```

1. **Spec and backlog.** The agent writes:
   - `SPEC.md`: goal, users, scope in and out, features with testable acceptance criteria, the stack with a reason per
     choice, open questions;
   - `BACKLOG.md`: the features as `- [ ]` items in build order, each small enough for one agent and naming the
     behaviour its test checks.
2. **Skeleton.** The standard layout for the stack, with a script for every check (setup, test, lint, and typecheck and
   build where they exist), one passing smoke test, a README with the exact commands, `.gitignore` and `.env.example`.
   The agent installs the dependencies and runs every check until they pass.
3. **Prepare.** The same as `nexus init` below.
4. **Commit** everything under your identity.
5. **Handover check.** If anything fails, the agent gets one repair round, then the check runs again.
6. **Build** (with `--build`): the first backlog items (`--take 5`) run in lanes and merge when every gate passes.
   `nexus lanes backlog` continues with the rest.

`nexus new` refuses a folder that already has files in it; use `nexus init` there.

## An existing repository

```bash
nexus init
```
```bash
nexus env check
```
```bash
nexus handover
```
```bash
nexus lanes run "add X" "fix Y" "rename Z" --parallel 3 --merge
```

## The handover check

`nexus handover` answers one question: can the next agent or person pick this repository up cold? Every item is
mechanical:

| Check | Passes when |
|---|---|
| agent instructions | `.nexus/config.json` exists and `nexus validate` finds no errors |
| check commands | a test command is detected (setup, lint, typecheck and build are listed when found) |
| tests | at least one test file is tracked |
| README | a README exists and shows commands, including how to test |
| spec and backlog | (`--spec`, and always after `nexus new`) `SPEC.md` exists and `BACKLOG.md` has items |
| no secrets tracked | no `.env` files in git, other than `.example`, `.sample` or `.template` |
| committed | there is a commit and the working tree is clean |
| checks pass | setup, then typecheck, lint, test and build, each exit 0 (skip with `--quick`) |

`--fix` gives the agent one round to repair what fails, and leaves the changes uncommitted for you to review.

Agents learn to keep the check passing from the `build-for-handover` skill, which is installed in every repository:
one command per check, a test with every behaviour, a README whose commands work, decisions in `docs/decisions.md`,
remaining work in `BACKLOG.md`, small files per feature, settings in `.env.example`, locked dependencies.

## Who decides what

| Decision | Decided by | Where it is recorded |
|---|---|---|
| Stack, languages, entry points | Detection from the files (no model) | `.nexus/config.json` → AGENTS.md |
| Setup, build, typecheck, lint, test commands | Detection from manifests and lockfiles; each command cites the file it came from | same |
| Environments (local, Docker, WSL, PowerShell, Google Cloud, AWS Lambda, Modal) | Evidence in the repository or on the machine, plus any you force in your profile or with `--env` | same, each with its evidence |
| Which skills to install | Base set (code-review, git-workflow, testing, debugging) plus one per detected environment | same, with a hash of each |
| Which agents get instruction files | Your profile (`agents`), or `--agents` | same |
| Git identity, no AI attribution, push and merge rules | **Your profile**, applied outside the repository: user-level agent files, this clone's git config, a local commit-msg hook | `~/.nexus/profile.json` |
| Project rules everyone must follow | You, in `.nexus/config.json` → `rules` | committed |
| Which paths always need you (CI, deploy, auth, migrations, dependencies) | `.nexus/config.json` → `escalate` (sensible defaults) | committed |
| The code change | The model | the job's branch |
| Whether a job is accepted | **Deterministic gates**, not a model | `.nexus/jobs/<id>/decision.md` |

Rule of thumb: **facts are detected, policy is yours, code is the model's, acceptance is mechanical.**

## What `nexus init` writes

- **`AGENTS.md`**: the one canonical instruction file, read by Codex, Cursor, Copilot, Gemini, Claude Code and
  Nexus. Nexus manages only the block between `<!-- nexus:begin -->` and `<!-- nexus:end -->`; your own text outside
  it is never touched. The block stays short (target under 1,000 tokens; `nexus validate` errors over 1,500).
- **Thin per-agent files** (`CLAUDE.md`, `.cursor/rules/agents.mdc`, `.github/copilot-instructions.md`, `GEMINI.md`):
  each points to `AGENTS.md`, so there is nothing to keep in sync.
- **Skills** in `.agents/skills/` (and `.claude/skills/` for Claude Code): copied, not linked, so the repository works
  without Nexus installed. If you edit a skill in the repository, later `init` runs keep your version.
- **`.nexus/config.json`**: everything decided above, with evidence. Edit it, re-run `nexus init`, and the files
  are re-rendered from it. Commands are re-detected on every run. A Makefile or justfile target wins over a guessed
  default, and Python tools run through `uv run`, `poetry run` or `pipenv run` when that lockfile exists. To pin a
  command of your own, set its `"evidence"` to `"owner"`: it is then kept and replaces the detected ones of its kind.
- **`.gitignore`** entries for Nexus's local state (index, logs, checkpoints, jobs), keeping `config.json` shared.
- **Local only, never committed:** `git config user.name/email` for this clone, and a `commit-msg` hook that rejects
  AI or tool attribution lines (`Co-Authored-By: <an AI>`, "Generated with ...", session links).

Run `nexus init --dry` to see the plan without writing anything. Running it twice changes nothing.

## Your profile

`~/.nexus/profile.json` holds rules that apply to every repository you work on and that do not belong in shared
projects: identity, no attribution, small changes straight to the default branch, `pull --rebase` and checks before
every push, never merge or force-push unasked. `nexus profile apply` writes them into your user-level agent files
(`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, depending on `agents`), inside a managed block.

```bash
nexus profile add rules "Do not deploy to production unless I say so for that deploy."
```
```bash
nexus profile set environments wsl,powershell
```

## Environments

`nexus env check` runs each detected environment's preflight and prints the exact fix for anything missing:

| Environment | Detected from | Checks |
|---|---|---|
| local | always | git |
| docker | `Dockerfile`, compose files | docker daemon |
| wsl | running in WSL, `.wslconfig` | repository not under `/mnt/c`, line endings |
| powershell | `.ps1` files, running on Windows | PowerShell 7 |
| gcp | `app.yaml`, `cloudbuild.yaml`, `firebase.json`, google-cloud dependencies | gcloud installed, signed in, project set |
| aws-lambda | SAM `template.yaml`, `cdk.json`, `serverless.yml`, AWS SDK dependencies | aws CLI, credentials |
| modal | `import modal` | modal CLI, token |

Each has a skill with the working practices: where code should live, quoting, secrets, and how to run a preview
instead of a production deploy. Skills are loaded only when a task needs them.

## Lanes: parallel jobs

`nexus lanes run "<task>" "<task>" ... [--parallel 3] [--merge] [--model <m>] [--max-cost 1]`, or
`nexus lanes backlog` to take the unchecked `- [ ]` items from `BACKLOG.md`.

1. **Plan lanes.** Each task's likely files come from the code index, or from the files the task names, plus their
   tests. Tasks that would touch the same files share a lane and run one after another; lanes run in parallel.
2. **Isolate.** Each job gets a numbered id (claimed atomically), a branch `job/<id>` and a worktree next to the
   repository (`../<repo>.jobs/<id>`). `node_modules` is shared from the main checkout; other stacks run `setup`.
3. **Build.** `nexus run` in the worktree, with a review round: before a change is accepted, the agent reviews its
   own full diff against the task (requirements, edge cases, other code that must change, regressions) and fixes what
   it finds.
4. **Gates**, all mechanical:
   - the agent finished;
   - something changed;
   - typecheck, lint, tests and build from `config.json` pass in the worktree (the build runs last, only if the
     faster checks passed);
   - the agent instructions still match the repository (the handover gate: no script, path or skill they name has
     gone);
   - no escalation path was touched;
   - the commit carries your identity;
   - `git merge-tree` shows it merges cleanly onto the current branch.
5. **Decide.** All gates pass: **approved**. Any check fails or an escalation path is touched: **needs-human**, with
   the reasons. The agent did not finish or changed nothing: **failed**. Evidence for each gate is in
   `.nexus/jobs/<id>/decision.md`.
6. **Merge** (with `--merge`, or later `nexus lanes merge <id>`): approved jobs are merged locally with
   `--no-ff`, one at a time. The next job in a lane starts from the merged result. **Nothing is ever pushed.**

`nexus lanes` lists jobs; `nexus lanes clean` removes the worktrees and branches of merged and failed jobs.

## Where the ideas came from

See [CREDITS.md](../CREDITS.md). In short:
- facts with evidence, then mechanical validation of the instruction file: agentskill;
- a whitelisted, size-capped harness surface and reject–retry–fallback: harness2;
- one canonical rule file with thin adapters, and the review evidence rule ("no concrete case, no finding"): ponytail;
- deterministic gates with machine-readable receipts, and pinning the base commit: archify;
- conflict awareness between parallel jobs: graphify;
- a pipeline of stages, worktree per job, atomic job claims, first-line verdict files and an escalation policy:
  the zazencodes software factory.

None of their code is used.

Older setups kept the config in `.nexus/factory.json`; it is still read, and the next `nexus init` moves it to
`.nexus/config.json`. `nexus factory` still works as an alias for `nexus lanes`.
