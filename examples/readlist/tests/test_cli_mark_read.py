"""Tests for the `mark-read` command: read flag, finished date and unknown ids."""

from __future__ import annotations

import subprocess
import sys
from datetime import date
from pathlib import Path

from readlist.models import Book
from readlist.storage import load_books, save_books


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Run the tool the way a user would, in a fresh interpreter."""
    return subprocess.run(
        [sys.executable, "-m", "readlist", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_book_becomes_read_with_todays_finished(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    assert run_cli("--file", str(path), "add", "Dune").returncode == 0
    result = run_cli("--file", str(path), "mark-read", "1")
    assert result.returncode == 0
    assert "Marked #1 as read: Dune" in result.stdout
    (book,) = load_books(path)
    assert book.read is True
    assert book.finished == date.today().isoformat()


def test_second_mark_read_keeps_first_finished_date(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    save_books(
        path,
        [Book(id=1, title="Dune", read=True, finished="2025-11-24")],
    )
    result = run_cli("--file", str(path), "mark-read", "1")
    assert result.returncode == 0
    (book,) = load_books(path)
    assert book.read is True
    assert book.finished == "2025-11-24"


def test_unknown_id_exits_1_and_leaves_file_unchanged(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    assert run_cli("--file", str(path), "add", "Dune").returncode == 0
    before = path.read_bytes()
    result = run_cli("--file", str(path), "mark-read", "99")
    assert result.returncode == 1
    assert result.stderr.strip()
    assert path.read_bytes() == before
