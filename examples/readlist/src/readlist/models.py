"""The record stored for one book, and its JSON form."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any


def _today() -> str:
    return date.today().isoformat()


@dataclass
class Book:
    """One book in the reading list.

    `id` is assigned once when the book is added and never reused.
    `finished` is the ISO date the book was marked read, or None.
    """

    id: int
    title: str
    author: str = ""
    read: bool = False
    added: str = field(default_factory=_today)
    finished: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """The JSON-serialisable form written to the data file."""
        return {
            "id": self.id,
            "title": self.title,
            "author": self.author,
            "read": self.read,
            "added": self.added,
            "finished": self.finished,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Book:
        """Rebuild a book from its JSON form; raises on a malformed entry."""
        finished = data.get("finished")
        return cls(
            id=int(data["id"]),
            title=str(data["title"]),
            author=str(data.get("author", "")),
            read=bool(data.get("read", False)),
            added=str(data.get("added", "")),
            finished=str(finished) if finished else None,
        )
