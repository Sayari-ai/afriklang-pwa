"""Provider base contract."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Candidate:
    """A single image candidate returned by a provider.

    Attributes:
        provider: Provider name, e.g. "pexels".
        source_id: Provider-side identifier (string for portability).
        download_url: Direct image URL to fetch.
        width: Reported pixel width (best-known).
        height: Reported pixel height.
        photographer: Display name to credit, if known.
        source_page_url: Canonical web page where the image lives.
        license: Short human-readable license token (e.g. "Pexels", "CC BY-SA 4.0").
        license_url: URL describing the license terms.
    """

    provider: str
    source_id: str
    download_url: str
    width: int
    height: int
    photographer: str | None
    source_page_url: str
    license: str
    license_url: str | None


class Provider(Protocol):
    name: str

    def search(self, query: str, *, per_page: int = 10) -> list[Candidate]:
        """Return candidate images for the query, ordered best-first."""
        ...
