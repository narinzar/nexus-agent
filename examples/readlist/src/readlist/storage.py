"""Locate, load and save the reading-list JSON file.

Every command goes through this module: `resolve_data_file` decides which file
to use, `load_books` reads it and `save_books` writes it atomically so a crash
never leaves a half-written list behind.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from readlist.models import Book

DATA_VERSION = 1
ENV_DATA_FILE = "READLIST_FILE"
DEFAULT_FILENAME = "readlist.json"


class StorageError(Exception):
    """The data file is unreadable, malformed or cannot be written."""


def default_data_file() -> Path:
    """Path used when neither --file nor $READLIST_FILE is given."""
    override = os.environ.get(ENV_DATA_FILE, "").strip()
    if override:
        return Path(override).expanduser()
    data_home = os.environ.get("XDG_DATA_HOME", "").strip()
    root = Path(data_home).expanduser() if data_home else Path.home() / ".local" / "share"
    return root / "readlist" / DEFAULT_FILENAME


def resolve_data_file(explicit: Path | None = None) -> Path:
    """--file wins over $READLIST_FILE, which wins over the default location."""
    if explicit is not None:
        return explicit.expanduser()
    return default_data_file()


def load_books(path: Path) -> list[Book]:
    """Return the books in `path`; a missing file is an empty list, not an error."""
    if not path.exists():
        return []
    try:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise StorageError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise StorageError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("books", []), list):
        raise StorageError(
            f"{path} is not a readlist file (expected an object with a 'books' list)"
        )
    try:
        return [Book.from_dict(item) for item in raw.get("books", [])]
    except (KeyError, TypeError, ValueError) as exc:
        raise StorageError(f"{path} has a book entry that cannot be read: {exc}") from exc


def save_books(path: Path, books: list[Book]) -> None:
    """Write `books` to `path` atomically, creating parent directories as needed."""
    payload = {"version": DATA_VERSION, "books": [book.to_dict() for book in books]}
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=path.name,
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        temp_path.replace(path)
    except OSError as exc:
        raise StorageError(f"cannot write {path}: {exc}") from exc
