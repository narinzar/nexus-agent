# Preparing a repository and running lanes

Nexus takes a repository from a list of changes to merged, checked work in three steps: **prepare** the repository (`nexus init`),
**make a change** (`nexus run`, the agent described in [architecture.md](architecture.md)), and **run many changes in
parallel lanes** (`nexus lanes run`). This guide covers steps 1 and 3: one command makes a repository ready for Nexus or any
other coding agent, then several tasks run at once, each in its own branch and worktree, reviewed, checked, and
merged only when every gate passes.

## New repository, start to finish

```bash
nexus profile set git.name <your-name>
```
```bash
nexus profile set git.email <your-email>
```
```bash
nexus profile apply
```
Run those three once per machine. Then, in each repository:
```bash
nexus init
```
```bash
nexus env check
```
```bash
nexus lanes run "add X" "fix Y" "rename Z" --parallel 3 --merge
```

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
  are re-rendered from it.
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
