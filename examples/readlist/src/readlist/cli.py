"""Command-line entry point for the readlist tool.

The parser and the exit codes live here. Each command in BACKLOG.md adds one
subparser in `build_parser` plus a `cmd_<name>` handler that takes the parsed
`argparse.Namespace` and returns an exit code; `main` dispatches to it.

Handlers get the data file from `storage.resolve_data_file(args.file)` so
`--file`, `$READLIST_FILE` and the default location keep working.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from datetime import date
from pathlib import Path

from readlist import __version__
from readlist.models import Book
from readlist.storage import StorageError, load_books, resolve_data_file, save_books

PROG = "readlist"
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_USAGE = 2


def build_parser() -> argparse.ArgumentParser:
    """Return the argument parser. Add one subparser per command here."""
    parser = argparse.ArgumentParser(
        prog=PROG,
        description="Keep a personal reading list in a local JSON file.",
    )
    parser.add_argument("--version", action="version", version=f"{PROG} {__version__}")
    parser.add_argument(
        "--file",
        metavar="PATH",
        type=Path,
        default=None,
        help=(
            "JSON file holding the list "
            "(default: $READLIST_FILE, else $XDG_DATA_HOME/readlist/readlist.json)"
        ),
    )
    subparsers = parser.add_subparsers(dest="command", metavar="COMMAND")

    add_parser = subparsers.add_parser("add", help="add a book to the list")
    add_parser.add_argument("title", metavar="TITLE", help="title of the book")
    add_parser.add_argument(
        "--author",
        metavar="NAME",
        default="",
        help="author of the book",
    )
    add_parser.set_defaults(handler=cmd_add)

    list_parser = subparsers.add_parser("list", help="list the books")
    filters = list_parser.add_mutually_exclusive_group()
    filters.add_argument(
        "--read", action="store_true", help="show only books already read"
    )
    filters.add_argument("--unread", action="store_true", help="show only unread books")
    list_parser.set_defaults(handler=cmd_list)

    mark_read_parser = subparsers.add_parser(
        "mark-read", help="mark a book as read"
    )
    mark_read_parser.add_argument("id", metavar="ID", type=int, help="id of the book")
    mark_read_parser.set_defaults(handler=cmd_mark_read)

    stats_parser = subparsers.add_parser("stats", help="show totals for the list")
    stats_parser.set_defaults(handler=cmd_stats)

    return parser


def cmd_add(args: argparse.Namespace) -> int:
    """Append one book with the next free id and print its assigned id."""
    title = args.title.strip()
    if not title:
        print(f"{PROG}: title must not be empty", file=sys.stderr)
        return EXIT_USAGE
    path = resolve_data_file(args.file)
    books = load_books(path)
    book = Book(
        id=max((existing.id for existing in books), default=0) + 1,
        title=title,
        author=args.author.strip(),
    )
    books.append(book)
    save_books(path, books)
    print(f"Added #{book.id}: {book.title}")
    return EXIT_OK


def cmd_list(args: argparse.Namespace) -> int:
    """Print one line per book in id order, honouring --read / --unread."""
    path = resolve_data_file(args.file)
    books = sorted(load_books(path), key=lambda book: book.id)
    if not books:
        print("No books yet.")
        return EXIT_OK
    for book in books:
        if args.read and not book.read:
            continue
        if args.unread and book.read:
            continue
        author = f" - {book.author}" if book.author else ""
        marker = "[x]" if book.read else "[ ]"
        print(f"#{book.id} {marker} {book.title}{author}")
    return EXIT_OK


def cmd_mark_read(args: argparse.Namespace) -> int:
    """Mark one book read and set its finished date to today.

    Marking a book that is already read keeps its first finished date. An
    unknown id is an error and leaves the file untouched.
    """
    path = resolve_data_file(args.file)
    books = load_books(path)
    for book in books:
        if book.id == args.id:
            break
    else:
        print(f"{PROG}: no book with id {args.id}", file=sys.stderr)
        return EXIT_ERROR
    if not book.read or not book.finished:
        book.read = True
        if not book.finished:
            book.finished = date.today().isoformat()
        save_books(path, books)
    print(f"Marked #{book.id} as read: {book.title}")
    return EXIT_OK


def cmd_stats(args: argparse.Namespace) -> int:
    """Print the total, read and unread counts; a missing file counts as empty."""
    path = resolve_data_file(args.file)
    books = load_books(path)
    total = len(books)
    read = sum(1 for book in books if book.read)
    print(f"Total: {total}")
    print(f"Read: {read}")
    print(f"Unread: {total - read}")
    return EXIT_OK


def report_storage_error(exc: StorageError) -> int:
    """Print one `readlist: ...` line on stderr and return the error code."""
    message = " ".join(str(exc).split())
    print(f"{PROG}: {message}", file=sys.stderr)
    return EXIT_ERROR


def main(argv: Sequence[str] | None = None) -> int:
    """Parse `argv` and dispatch. Returns the process exit code.

    Every handler goes through this one wrapper, so a bad data file becomes a
    single error line and exit code 1 for any command instead of a traceback.
    """
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "handler"):
        parser.print_help()
        return EXIT_OK
    try:
        return int(args.handler(args))
    except StorageError as exc:
        return report_storage_error(exc)
