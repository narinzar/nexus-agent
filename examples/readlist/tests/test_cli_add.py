"""Tests for the `add` command: appending books, ids and file creation."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from readlist.storage import load_books


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Run the tool the way a user would, in a fresh interpreter."""
    return subprocess.run(
        [sys.executable, "-m", "readlist", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_two_adds_get_ids_one_and_two(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    first = run_cli("--file", str(path), "add", "Dune")
    second = run_cli("--file", str(path), "add", "Piranesi")
    assert first.returncode == 0
    assert second.returncode == 0
    assert "Added #1: Dune" in first.stdout
    assert "Added #2: Piranesi" in second.stdout
    books = load_books(path)
    assert [book.id for book in books] == [1, 2]
    assert [book.title for book in books] == ["Dune", "Piranesi"]
    assert [book.read for book in books] == [False, False]
    assert all(book.added for book in books)


def test_author_is_stored(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    result = run_cli(
        "--file", str(path), "add", "Dune", "--author", "Frank Herbert"
    )
    assert result.returncode == 0
    (book,) = load_books(path)
    assert book.author == "Frank Herbert"


def test_empty_title_exits_2_and_leaves_file_unchanged(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    assert run_cli("--file", str(path), "add", "Dune").returncode == 0
    before = path.read_bytes()
    result = run_cli("--file", str(path), "add", "   ")
    assert result.returncode == 2
    assert path.read_bytes() == before


def test_missing_file_directory_is_created(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "deeper" / "list.json"
    result = run_cli("--file", str(path), "add", "Dune")
    assert result.returncode == 0
    assert path.exists()
    assert [book.title for book in load_books(path)] == ["Dune"]
