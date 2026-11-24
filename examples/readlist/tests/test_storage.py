"""Tests for the data layer: finding, loading and saving the JSON file."""

from __future__ import annotations

from pathlib import Path

import pytest

from readlist.models import Book
from readlist.storage import StorageError, load_books, resolve_data_file, save_books


def test_load_missing_file_returns_empty_list(tmp_path: Path) -> None:
    assert load_books(tmp_path / "missing.json") == []


def test_save_then_load_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "list.json"
    books = [
        Book(id=1, title="Dune", author="Frank Herbert"),
        Book(id=2, title="Piranesi", read=True, finished="2024-05-01"),
    ]
    save_books(path, books)
    assert load_books(path) == books


def test_corrupt_file_raises_storage_error(tmp_path: Path) -> None:
    path = tmp_path / "list.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(StorageError):
        load_books(path)


def test_resolve_data_file_prefers_explicit_path(tmp_path: Path) -> None:
    explicit = tmp_path / "explicit.json"
    assert resolve_data_file(explicit) == explicit
