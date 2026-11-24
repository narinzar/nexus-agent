---
name: git-workflow
description: Git and GitHub procedures (branches, commits, rebases, conflicts, pull requests, bisect). Use for any version-control operation, preparing a commit or pull request, or resolving merge conflicts.
---

# Git workflow

**Inspect before acting.** Run `git status`, `git diff`, `git log --oneline -10` and `git branch -vv`. Follow the repo's
own rules first: AGENTS.md, CLAUDE.md, CONTRIBUTING.md.

**Commits**
- One logical change per commit. Messages use an imperative subject (≤72 characters) and a body that says why.
- Never commit secrets, build output or local config. Check `git diff --cached` before committing.

**History**
- Never rewrite published history or force-push shared branches unless explicitly asked.
- Prefer `git revert` to undo published commits.

**Conflicts**
- Understand both sides first: `git log --merge -p <file>`.
- Keep both intents, then run tests. Never resolve by blindly taking one side.

**Bisect**
1. `git bisect start <bad> <good>`.
2. Run `git bisect run <test command>` with a test that exits non-zero on failure.

**Pull requests**
- Use the repo's PR template when present.
- Describe what changed, why, how it was verified, and any risks or follow-ups.
- Keep PRs small. Link issues.

**Risky operations:** push, reset --hard, clean -f, branch -D, rebase of shared branches. These require explicit
approval.
