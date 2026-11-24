# Decisions

One line per decision: date, what, why. Newest last.

- 2025-11-24 - Python 3.11+ with the standard library only at runtime. The task needs JSON and argument parsing,
  both built in; no dependency to install or pin for a tool this small.
- 2025-11-24 - `argparse` subcommands instead of Click or Typer. Zero dependencies, and bad arguments already exit
  with code 2, which the spec promises.
- 2025-11-24 - One JSON file shaped `{"version": 1, "books": [...]}`, written with a temp file and an atomic
  `replace`. Hand-editable and diffable; a crash mid-write cannot corrupt the list.
- 2025-11-24 - Books are addressed by a small integer `id` assigned once and never reused. Other commands need a
  stable handle and the user can read it off `list`.
- 2025-11-24 - `src/` layout, `hatchling` build backend, `uv` with a committed `uv.lock`. The tests import the
  installed package, and setup is one command (`uv sync`).
- 2025-11-24 - `pytest`, `ruff` and `mypy` as dev dependencies behind Makefile targets (`test`, `lint`,
  `typecheck`, `build`). One command per check, identical locally and in CI.
- 2025-11-26 - mypy gets `mypy_path = "src"` and does not follow imports into
  `_pytest`/`numpy`. Installed pytest ships `py.typed` and imports numpy under
  `TYPE_CHECKING`, whose stubs need `python_version >= 3.12`; the project targets the
  documented `mypy .` check over its own modules, not the runner's internals.
- 2025-11-24 - Every storage failure is caught once, in `main`, and printed as a single
  `readlist: ...` line on stderr with exit `1` (`report_storage_error`). One wrapper means no
  command can forget the handling or leak a traceback, and a bad file is never rewritten
  because handlers load before they save.
- 2025-11-24 - The data file comes from `--file`, then `$READLIST_FILE`, then
  `$XDG_DATA_HOME/readlist/readlist.json`. The CLI override is explicit, and the XDG default is the usual place on
  Linux.
