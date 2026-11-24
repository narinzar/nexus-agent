"""End-to-end test: the README example through the real command line."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Run the tool the way a user would, in a fresh interpreter."""
    return subprocess.run(
        [sys.executable, "-m", "readlist", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_readme_example_end_to_end(tmp_path: Path) -> None:
    """add, add, list, mark-read, stats compose as the README describes."""
    path = tmp_path / "list.json"

    def readlist(*args: str) -> subprocess.CompletedProcess[str]:
        return run_cli("--file", str(path), *args)

    added = readlist("add", "Dune", "--author", "Frank Herbert")
    assert added.returncode == 0
    assert added.stdout.splitlines() == ["Added #1: Dune"]
    assert added.stderr == ""

    added = readlist("add", "Piranesi", "--author", "Susanna Clarke")
    assert added.returncode == 0
    assert added.stdout.splitlines() == ["Added #2: Piranesi"]

    listed = readlist("list")
    assert listed.returncode == 0
    assert listed.stdout.splitlines() == [
        "#1 [ ] Dune - Frank Herbert",
        "#2 [ ] Piranesi - Susanna Clarke",
    ]

    marked = readlist("mark-read", "1")
    assert marked.returncode == 0
    assert marked.stdout.splitlines() == ["Marked #1 as read: Dune"]
    assert marked.stderr == ""

    listed = readlist("list")
    assert listed.returncode == 0
    assert listed.stdout.splitlines() == [
        "#1 [x] Dune - Frank Herbert",
        "#2 [ ] Piranesi - Susanna Clarke",
    ]

    stats = readlist("stats")
    assert stats.returncode == 0
    assert stats.stdout.splitlines() == ["Total: 2", "Read: 1", "Unread: 1"]
    assert stats.stderr == ""

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["version"] == 1
    books = payload["books"]
    today = date.today().isoformat()
    assert [book["id"] for book in books] == [1, 2]
    assert [book["title"] for book in books] == ["Dune", "Piranesi"]
    assert [book["author"] for book in books] == ["Frank Herbert", "Susanna Clarke"]
    assert [book["read"] for book in books] == [True, False]
    assert [book["finished"] for book in books] == [today, None]
    assert [book["added"] for book in books] == [today, today]
