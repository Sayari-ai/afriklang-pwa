"""Unsplash API provider.

Docs: https://unsplash.com/documentation
License: Unsplash License (free, attribution required).
"""
from __future__ import annotations

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from .base import Candidate

API = "https://api.unsplash.com/search/photos"


class UnsplashProvider:
    name = "unsplash"

    def __init__(self, access_key: str) -> None:
        self._headers = {"Authorization": f"Client-ID {access_key}"}

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
        for photo in data.get("results", []):
            urls = photo.get("urls", {})
            url = urls.get("regular") or urls.get("full") or urls.get("raw")
            if not url:
                continue
            user = photo.get("user", {})
            out.append(
                Candidate(
                    provider=self.name,
                    source_id=str(photo["id"]),
                    download_url=url,
                    width=int(photo.get("width", 0)),
                    height=int(photo.get("height", 0)),
                    photographer=user.get("name"),
                    source_page_url=photo.get("links", {}).get("html", ""),
                    license="Unsplash License",
                    license_url="https://unsplash.com/license",
                )
            )
        return out
