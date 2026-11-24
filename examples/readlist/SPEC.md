# readlist - specification

## Goal

`readlist` is a small command-line tool that keeps one person's reading list in a single local JSON file. It does
four things and nothing else: add a book, list the books, mark a book as read, and print simple stats (total, read,
unread). The file is plain JSON the user owns and can edit by hand, the tool has no runtime dependencies outside
the Python standard library, and every error is reported as one plain line on stderr with a non-zero exit code.

## Who it is for

One reader who lives in a terminal and wants a list they can keep in a file, back up and diff - not a web app, not
a social reading service, not a sync product.

## In scope

- Four commands: `add`, `list`, `mark-read`, `stats`.
- One list per data file; the file is chosen by `--file`, else `$READLIST_FILE`, else a default under
  `$XDG_DATA_HOME` (`~/.local/share/readlist/readlist.json`).
- Human-readable, hand-editable JSON (`{"version": 1, "books": [...]}`), written atomically.
- Clear messages and exit codes: `0` fine, `1` bad or unreadable data file, `2` bad arguments.
- Python 3.11+; standard library only at runtime.

## Out of scope

- Network access of any kind: no ISBN lookup, no metadata fetching, no cover art.
- Editing, removing or re-ordering books; ratings, notes, tags, page progress.
- Multiple lists, sync, shared lists, accounts.
- A GUI or a TUI.

## Features and acceptance criteria

Each criterion is testable from the command line and is checked by the named test in the backlog item.

### F1 - `add`: add a book

`readlist add "<title>" [--author "<name>"]` appends a book to the list.

- A new book gets the next free integer `id` (1, then 2, ...; ids are never reused), `read` false, `added` today.
- The command prints `Added #<id>: <title>` and exits `0`; the book is in the file immediately.
- The data file and its parent directories are created if missing.
- An empty or whitespace-only title is a usage error: message on stderr, exit `2`, file unchanged.
- `--author` defaults to the empty string.

### F2 - `list`: list the books

`readlist list [--unread] [--read]` prints the books, one per line, in the order they were added.

- Each line shows the id, the title, the author when present, and a read marker for books already read.
- `--unread` shows only unread books, `--read` only read ones; passing both is a usage error (exit `2`).
- An empty list prints `No books yet.` and exits `0`.
- A missing data file is an empty list, not an error.

### F3 - `mark-read`: mark a book as read

`readlist mark-read <id>` marks the book with that id read and records the date.

- The book's `read` becomes true and `finished` becomes today's ISO date; the change is saved.
- The command prints `Marked #<id> as read: <title>` and exits `0`.
- An already-read book stays read and keeps its original `finished` date; the command says so and exits `0`.
- An unknown id prints an error on stderr and exits `1`; the file is unchanged.
- A non-integer argument is a usage error (exit `2`) reported by argparse.

### F4 - `stats`: total, read and unread counts

`readlist stats` prints three labelled counts and exits `0`.

- `Total: N`, `Read: R`, `Unread: U`, with `R + U == N`.
- An empty or missing data file prints `Total: 0`, `Read: 0`, `Unread: 0`.

### F5 - robustness shared by all commands

- A corrupt JSON file, or a file whose shape is not `{"version": ..., "books": [...]}`, produces one error line
  on stderr and exit `1`; the file is never overwritten in that case.
- Writes are atomic: an interrupted write leaves the previous file intact.
- `--file` beats `$READLIST_FILE`, which beats the default path.

## Stack and why

| Choice | Reason |
| --- | --- |
| Python 3.11+ | Installed everywhere, and the standard library covers JSON and argparse with zero runtime dependencies. |
| `argparse` | Built in, so subcommands and exit code `2` on bad arguments come for free. |
| One JSON file with an atomic replace | Hand-editable and diffable, and a crash cannot truncate the list. |
| `uv` + `hatchling` | Lockfile committed, one command (`uv sync`) to set up, reproducible builds. |
| `pytest` | The de-facto test runner; plain asserts and `tmp_path` for real files. |
| `ruff` | Lint and format in one fast tool with no config sprawl. |
| `mypy` | Type checks shared by humans and agents; typed defs required. |
| `make` targets | One documented command per check, the same locally and in CI. |
| `src/` layout | Imports resolve only from the installed package, which keeps the tests honest. |

## Open questions

- Should `add` refuse a duplicate title+author, or add it anyway? (Current backlog: add anyway; revisit if it bites.)
- Should `list` sort by title or by id? (Chosen: insertion order, i.e. id.)
- Should there be an `id` for lookup, or should the user type part of the title? (Chosen: id; `list` shows it.)
- Do we ever want `remove` or `edit`? Out of scope until the four commands are solid.
- Is the `finished` date enough, or do we want a read count for re-reads? Out of scope for v1.
