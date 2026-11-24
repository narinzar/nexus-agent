# Contributing

Thanks for helping. The rules for people and coding agents are the same, and they live in [AGENTS.md](AGENTS.md).

## Set up

```bash
git clone https://github.com/narinzar/nexus-agent
```
```bash
cd nexus-agent && npm install
```

Node.js 22.18 or newer runs the TypeScript sources directly; there is no build step.

## Before you open a pull request

- `npm run check` (typecheck and tests) passes.
- New behaviour has a test in `tests/`.
- Language-specific code goes in the language tables (`src/repo-intel/heuristic`, `treesitter.ts`, `resolve.ts`,
  `detect.ts`) or in a skill, never in the core.
- A new dependency comes with a reason in [docs/research.md](docs/research.md): licence, size, maintenance.
- A claim that something is faster, cheaper or better comes with a benchmark result
  ([benchmarks/README.md](benchmarks/README.md)).

## Adding things

| To add | Where |
|---|---|
| a language | `src/repo-intel/languages.ts`, plus parser and import rules in the files above |
| an AI provider | `src/models/adapters.ts` |
| a skill | `skills/<name>/SKILL.md` ([Agent Skills](https://agentskills.io) format) |
| an environment for `nexus env` | `src/lanes/environments.ts` and a matching `skills/env-<id>/SKILL.md` |
| a benchmark task | `benchmarks/suites/*.json` (see [benchmarks/README.md](benchmarks/README.md)) |
