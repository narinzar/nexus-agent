# readlist

<!-- nexus:begin (managed by `nexus init`; edit outside this block or in .nexus/config.json) -->
## Project

- Languages: python; frameworks: pytest, numpy.
- Entry points: `src/readlist/__main__.py`, `src/readlist/cli.py`.
- Read first: `README.md`, `docs/decisions.md`.

## Commands

- setup: `uv sync`
- build: `make build` (from `Makefile`)
- typecheck: `make typecheck` (from `Makefile`)
- lint: `make lint` (from `Makefile`)
- test: `make test` (from `Makefile`)
- format: `make format` (from `Makefile`)
- run: `make run` (from `Makefile`)

## Working rules

- Verify every change with the cheapest command above that covers it before saying it is done. Report what was not checked.
- Review your own diff before finishing: every requirement met, edge cases, other code that must change too, no unrelated changes.
- Leave the repository ready for the next agent: checks pass, the change has a test, README and BACKLOG.md are current (skill `build-for-handover`).

## Finding code

Query the code index before reading whole files: `nexus locate "<task>"`, `nexus ctx <symbol>`, `nexus show <symbol|file:a-b>`, `nexus refs <symbol>`, `nexus impact` (what a change affects and which tests cover it).

## Environments and skills

- Local machine: see skill `env-local` (evidence: `always`).
- Skills in `.agents/skills/`: build-for-handover, code-review, git-workflow, testing, debugging, env-local. Load one only when the task needs it.
<!-- nexus:end -->
