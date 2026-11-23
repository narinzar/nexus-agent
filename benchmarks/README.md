# Benchmarks

Every efficiency or quality claim in this repository comes from here. The agent never sees the hidden tests.

| Path | What is inside |
|---|---|
| `REPORT.md` | the report: method, tables per suite, earlier runs. Generated; do not edit by hand. |
| `charts/` | SVG charts used by the README and the report. Generated. |
| `suites/` | task lists. `small.json`: fixture projects in several languages. `large.json`: real public repositories, each task pinned to an upstream fix commit. |
| `fixtures/` | the small projects the small suite runs on |
| `hidden-tests/` | the tests that decide pass or fail for fixture tasks, copied in only after the agent finishes |
| `results/` | raw results, one JSON file per run, saved after every task |
| `reports/` | written notes on individual benchmark runs |

## Run

```bash
nexus bench --suite large --repeat 3 --variants nexus@claude-cli,claude-code
```

- `--variants` lists configurations, comma-separated:
  - `nexus@<model>` is Nexus with that model;
  - `nexus+review@<model>` is the same with the review round always on;
  - `claude-code` is stock Claude Code, the baseline.
- `--repeat N` runs each task N times.
- `--max-cost <dollars>` caps each run.
- `--resume <results file>` continues a stopped run, skipping what is already saved.
- `--variants none,oracle` validates a suite: every task must fail with no change and pass with the upstream fix.

The large suite clones its public repositories itself. Task K2 runs on a private Next.js site and is included only
when `KADD_REPO` points at a local clone of it; without that, it is skipped.

## Report

```bash
nexus bench report
```

Rebuilds `REPORT.md` and `charts/` from every complete file in `results/`. A stopped run's file is marked incomplete
and left out until it is resumed and finished.
