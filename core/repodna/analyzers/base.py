from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from repodna.model import FileRecord, PartialAnalysis


class LanguageAnalyzer(ABC):
    extensions: frozenset[str]

    def supports(self, path: Path) -> bool:
        return path.suffix.lower() in self.extensions

    @abstractmethod
    def analyze(self, file: FileRecord, source: str) -> PartialAnalysis:
        """Read source as text and return structural evidence without executing it."""

