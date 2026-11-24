"""Data-file errors: every command fails the same way on a bad file.

A corrupt or wrongly shaped file must produce exactly one `readlist: ...`
line on stderr, exit code 1, and no rewrite of the file.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

CORRUPT = "{not json"
WRONG_SHAPE = '{"version": 1, "books": 3}'
BAD_CONTENTS = [
    pytest.param(CORRUPT, id="corrupt"),
    pytest.param(WRONG_SHAPE, id="wrong-shape"),
]
COMMANDS = [
    ("add", "Dune"),
    ("list",),
    ("mark-read", "1"),
    ("stats",),
]


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Run the tool the way a user would, in a fresh interpreter."""
    return subprocess.run(
        [sys.executable, "-m", "readlist", *args],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize("content", BAD_CONTENTS)
@pytest.mark.parametrize("command", COMMANDS, ids=lambda command: command[0])
def test_bad_data_file_exits_1_and_is_not_rewritten(
    tmp_path: Path, command: tuple[str, ...], content: str
) -> None:
    path = tmp_path / "list.json"
    path.write_text(content, encoding="utf-8")
    before = path.read_bytes()
    result = run_cli("--file", str(path), *command)
    assert result.returncode == 1
    assert result.stdout == ""
    assert result.stderr.startswith("readlist:")
    assert result.stderr.count("\n") == 1
    assert path.read_bytes() == before
