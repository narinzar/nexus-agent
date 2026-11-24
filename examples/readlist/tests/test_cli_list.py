"""Tests for the `list` command: id order, read markers, filters and the empty list."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from readlist.models import Book
from readlist.storage import save_books


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Run the tool the way a user would, in a fresh interpreter."""
    return subprocess.run(
        [sys.executable, "-m", "readlist", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_three_added_books_list_in_id_order(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    for args in (
        ("Dune", "--author", "Frank Herbert"),
        ("Piranesi", "--author", "Susanna Clarke"),
        ("Solaris",),
    ):
        assert run_cli("--file", str(path), "add", *args).returncode == 0
    result = run_cli("--file", str(path), "list")
    assert result.returncode == 0
    assert result.stdout.splitlines() == [
        "#1 [ ] Dune - Frank Herbert",
        "#2 [ ] Piranesi - Susanna Clarke",
        "#3 [ ] Solaris",
    ]


def test_filters_select_the_right_subset(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    save_books(
        path,
        [
            Book(
                id=1,
                title="Dune",
                author="Frank Herbert",
                read=True,
                finished="2025-11-24",
            ),
            Book(id=2, title="Piranesi", author="Susanna Clarke"),
            Book(id=3, title="Solaris", read=True, finished="2025-11-25"),
        ],
    )
    unread = run_cli("--file", str(path), "list", "--unread")
    assert unread.returncode == 0
    assert unread.stdout.splitlines() == ["#2 [ ] Piranesi - Susanna Clarke"]
    read = run_cli("--file", str(path), "list", "--read")
    assert read.returncode == 0
    assert read.stdout.splitlines() == [
        "#1 [x] Dune - Frank Herbert",
        "#3 [x] Solaris",
    ]


def test_read_and_unread_together_exit_2(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    assert run_cli("--file", str(path), "add", "Dune").returncode == 0
    result = run_cli("--file", str(path), "list", "--read", "--unread")
    assert result.returncode == 2
    assert result.stderr.strip()


def test_missing_file_prints_empty_message(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    result = run_cli("--file", str(path), "list")
    assert result.returncode == 0
    assert result.stdout.strip() == "No books yet."


def test_file_with_no_books_prints_empty_message(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    save_books(path, [])
    result = run_cli("--file", str(path), "list")
    assert result.returncode == 0
    assert result.stdout.strip() == "No books yet."
