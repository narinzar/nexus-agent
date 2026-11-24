---
name: env-local
description: Working on a local machine or with containers - reproducible setup, running the app and its checks, Docker and compose, ports, environment variables and secrets. Use when setting up, running, building or containerising the project locally.
---

# Local machine and containers

**Setup is a command, not a story.** Use the `setup` command from AGENTS.md (for example `npm ci`, `uv sync`, `go mod download`), not ad-hoc installs.
- Install from the lockfile. Never update it as a side effect of setup.
- Pin tool versions in a file the tools read: `.nvmrc` / `engines`, `.python-version`, `go.mod` `toolchain`, `rust-toolchain.toml`.

**Secrets**
- Real values go in `.env.local` or the OS keychain, never in git.
- Commit `.env.example` with names and dummy values only.
- Never print a secret: no `cat .env`, no echoing tokens, no logging request headers.

**Ports and processes**
- One dev server per worktree. With parallel jobs, give each its own port (`PORT=5100+n`).
- Stop what you start. Run long processes in the background and record how to stop them.

**Containers**
- Multi-stage `Dockerfile`: build stage with the toolchain, small runtime stage, non-root user, `.dockerignore` covering `node_modules`, `.git`, `.env*`.
- `docker compose up -d` for dependencies (databases, queues). Use healthchecks rather than sleeps.
- Build with the same commands as CI so a local pass means a CI pass.

**Before saying done:** the project's typecheck, lint and tests from AGENTS.md pass locally. Say which ones ran and which were skipped.
