"""Perceptual-hash dedupe across the entire run.

State persists in the ledger so concurrent and resumed runs share the
same dedupe registry.
"""
from __future__ import annotations

from pathlib import Path

import imagehash
from PIL import Image

from config import PHASH_HAMMING_THRESHOLD


class Deduper:
    """Holds a list of accepted phashes and answers similarity queries."""

    def __init__(self, existing_hashes: list[str] | None = None) -> None:
        self._hashes: list[imagehash.ImageHash] = []
        if existing_hashes:
            for h in existing_hashes:
                try:
                    self._hashes.append(imagehash.hex_to_hash(h))
                except (ValueError, TypeError):
                    continue

    @staticmethod
    def compute(path: Path) -> str:
        with Image.open(path) as im:
            return str(imagehash.phash(im))

    def is_duplicate(self, phash_hex: str) -> bool:
        try:
            new_hash = imagehash.hex_to_hash(phash_hex)
        except (ValueError, TypeError):
            return False
        return any(
            (new_hash - existing) <= PHASH_HAMMING_THRESHOLD
            for existing in self._hashes
        )

    def register(self, phash_hex: str) -> None:
        try:
            self._hashes.append(imagehash.hex_to_hash(phash_hex))
        except (ValueError, TypeError):
            pass

    def all_hex(self) -> list[str]:
        return [str(h) for h in self._hashes]
