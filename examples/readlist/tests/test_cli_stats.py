"""Tests for the `stats` command: total, read and unread counts."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from readlist.storage import save_books


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Run the tool the way a user would, in a fresh interpreter."""
    return subprocess.run(
        [sys.executable, "-m", "readlist", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_two_books_one_read_counts_2_1_1(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    assert run_cli("--file", str(path), "add", "Dune").returncode == 0
    assert run_cli("--file", str(path), "add", "Piranesi").returncode == 0
    assert run_cli("--file", str(path), "mark-read", "1").returncode == 0
    result = run_cli("--file", str(path), "stats")
    assert result.returncode == 0
    assert result.stdout.splitlines() == ["Total: 2", "Read: 1", "Unread: 1"]


def test_missing_file_prints_zeros(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    result = run_cli("--file", str(path), "stats")
    assert result.returncode == 0
    assert result.stdout.splitlines() == ["Total: 0", "Read: 0", "Unread: 0"]


def test_file_with_no_books_prints_zeros(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    save_books(path, [])
    result = run_cli("--file", str(path), "stats")
    assert result.returncode == 0
    assert result.stdout.splitlines() == ["Total: 0", "Read: 0", "Unread: 0"]
