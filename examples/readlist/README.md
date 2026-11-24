# readlist

A small command-line tool that keeps a personal reading list in one local JSON file: add a book, list books,
mark a book as read, and show simple stats.

Status: **in progress**. The package, the data layer (`Book`, load/save) and the commands `add`, `list`,
`mark-read` and `stats` exist and are tested; the remaining work is the items in [BACKLOG.md](BACKLOG.md) and is
built one at a time.

## Requirements

- Python 3.11 or newer
- [uv](https://docs.astral.sh/uv/) for the environment and the checks (the Makefile wraps it)

## Setup

```sh
git clone <repo-url> readlist
cd readlist
make setup
```

`make setup` creates `.venv` from `pyproject.toml` / `uv.lock` and installs the `readlist` command into it.

## Run

```sh
uv run readlist --help
uv run readlist --version
uv run readlist add "Dune" --author "Frank Herbert"
uv run readlist list
uv run readlist list --unread
uv run readlist mark-read 1
uv run readlist stats
```

`list` prints one line per book in id order, `#<id> [x] <title> - <author>`, with `[x]` for a book already
read; `--unread` and `--read` narrow the output (both together is a usage error, exit `2`), and an empty list
prints `No books yet.`

`mark-read <id>` marks a book read and stores today's date as its `finished` date, printing
`Marked #<id> as read: <title>`. Marking a book that is already read keeps its first `finished` date; an unknown
id prints an error on stderr and exits `1` without touching the file.

`stats` prints three lines - `Total: N`, `Read: R`, `Unread: U`, with `R + U == N` - and exits `0`; a missing or
empty list prints `Total: 0`, `Read: 0`, `Unread: 0`.

## Checks

| Command | What it does |
| --- | --- |
| `make setup` | create `.venv`, install the project and dev tools |
| `make test` | run the pytest suite |
| `make lint` | run ruff |
| `make typecheck` | run mypy over `src` and `tests` |
| `make build` | build the sdist and wheel into `dist/` |
| `make check` | lint + typecheck + test |

## Configuration

Settings come from the environment (see `.env.example`); the tool does **not** read `.env` itself.
The only setting today:

- `READLIST_FILE` - path of the JSON list. Default: `$XDG_DATA_HOME/readlist/readlist.json`, or
  `~/.local/share/readlist/readlist.json` when `XDG_DATA_HOME` is unset. The global `--file` option wins over it.

## Layout

- `src/readlist/cli.py` - argparse entry point (`main`), exit codes, command dispatch.
- `src/readlist/models.py` - the `Book` record and its JSON form.
- `src/readlist/storage.py` - locate, load and save the JSON file (atomic replace).
- `tests/` - pytest tests, one file per module.
- `SPEC.md` - goal, scope, features with acceptance criteria, stack choices, open questions.
- `BACKLOG.md` - the features as small, separately buildable items in build order.
- `docs/decisions.md` - why things are the way they are.

## Exit codes

`0` success, `1` runtime error (bad or unreadable data file), `2` usage error (bad arguments).

A corrupt or wrongly shaped data file makes **every** command (`add`, `list`, `mark-read`, `stats`) print one
`readlist: ...` line on stderr, exit `1`, and leave the file exactly as it was.
