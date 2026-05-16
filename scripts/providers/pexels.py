"""Pexels API provider.

Docs: https://www.pexels.com/api/documentation/
License: Pexels License (free for commercial use, attribution appreciated).
"""
from __future__ import annotations

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from .base import Candidate

API = "https://api.pexels.com/v1/search"


class PexelsProvider:
    name = "pexels"

    def __init__(self, api_key: str) -> None:
        self._headers = {"Authorization": api_key}

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
    def search(self, query: str, *, per_page: int = 10) -> list[Candidate]:
        resp = requests.get(
            API,
            params={"query": query, "per_page": per_page, "orientation": "landscape"},
            headers=self._headers,
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()

        out: list[Candidate] = []
        for photo in data.get("photos", []):
            src = photo.get("src", {})
            url = src.get("large2x") or src.get("large") or src.get("original")
            if not url:
                continue
            out.append(
                Candidate(
                    provider=self.name,
                    source_id=str(photo["id"]),
                    download_url=url,
                    width=int(photo.get("width", 0)),
                    height=int(photo.get("height", 0)),
                    photographer=photo.get("photographer"),
                    source_page_url=photo.get("url", ""),
                    license="Pexels License",
                    license_url="https://www.pexels.com/license/",
                )
            )
        return out
