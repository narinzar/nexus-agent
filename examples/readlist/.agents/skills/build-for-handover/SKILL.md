---
name: build-for-handover
description: Building or extending a project so the next agent or person can pick it up cold - one command per check, a test with every behaviour, a README whose commands work, decisions and remaining work written down. Use when starting a project, adding a feature, or finishing any piece of work.
---

# Build for handover

The next worker, an agent or a person, starts with no memory of this session. Everything they need must be in the
repository, and every claim must be checkable with a command. `nexus handover` checks this mechanically.

**One command per check.** Setup, test, lint, typecheck and build each live as a script in the manifest
(`package.json` scripts, `pyproject.toml`, `Makefile`, ...). No step exists only in a chat or in your head.

**A test with every behaviour.**
- Each feature lands with a test that fails without it.
- Keep one fast smoke test that proves the project starts.
- Put tests where the stack's tools find them by default.

**A README whose commands work.** It says what the project is and gives the exact commands to set up, run and test it
on a fresh clone. Update it in the same change as the behaviour it describes.

**Decisions written down.**
- `SPEC.md` holds the goal, scope and acceptance criteria.
- When you choose a library or data format, or reject an approach, add a line to `docs/decisions.md`: date, decision,
  why.

**Remaining work as the handover queue.**
- Work not done goes to `BACKLOG.md` as `- [ ] ` items small enough for one agent: one behaviour, one test, the files
  involved when you know them.
- When you are one of several parallel jobs, leave your own item's line alone (Nexus records the outcome); only add
  new items you discovered.

**Small, conventional structure.**
- Use the standard layout for the stack, one responsibility per module, and names that say what things do.
- Keep each feature in its own files where you can. Lanes run tasks in parallel only when they touch different files.

**Configuration, not constants.**
- Settings come from environment variables listed in `.env.example`.
- Never commit secrets or real `.env` files.

**Pin and lock.** Commit the lockfile. Pin tool versions where the stack allows (`engines`, `.nvmrc`,
`requires-python`, `go` directive).

**Leave it green.** Finish only when every check passes on a clean checkout, and say what you did not check.
