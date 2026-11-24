"""Smoke tests: the installed package runs and answers --help/--version."""

from __future__ import annotations

import subprocess
import sys

from readlist import __version__


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    """Run the tool the way a user would, in a fresh interpreter."""
    return subprocess.run(
        [sys.executable, "-m", "readlist", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_help_lists_usage() -> None:
    result = run_cli("--help")
    assert result.returncode == 0
    assert "usage: readlist" in result.stdout


def test_version_flag_prints_version() -> None:
    result = run_cli("--version")
    assert result.returncode == 0
    assert __version__ in result.stdout


def test_no_command_prints_help() -> None:
    result = run_cli()
    assert result.returncode == 0
    assert "usage: readlist" in result.stdout
