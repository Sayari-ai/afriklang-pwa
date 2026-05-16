"""Pixabay API provider.

Docs: https://pixabay.com/api/docs/
License: Pixabay Content License (free, no attribution required).
"""
from __future__ import annotations

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from .base import Candidate

API = "https://pixabay.com/api/"


class PixabayProvider:
    name = "pixabay"

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
    def search(self, query: str, *, per_page: int = 10) -> list[Candidate]:
        resp = requests.get(
            API,
            params={
                "key": self._api_key,
                "q": query,
                "per_page": max(per_page, 3),  # Pixabay min is 3
                "image_type": "photo",
                "safesearch": "true",
                "orientation": "horizontal",
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()

        out: list[Candidate] = []
        for hit in data.get("hits", []):
            url = hit.get("largeImageURL") or hit.get("webformatURL")
            if not url:
                continue
            out.append(
                Candidate(
                    provider=self.name,
                    source_id=str(hit["id"]),
                    download_url=url,
                    width=int(hit.get("imageWidth", 0)),
                    height=int(hit.get("imageHeight", 0)),
                    photographer=hit.get("user"),
                    source_page_url=hit.get("pageURL", ""),
                    license="Pixabay Content License",
                    license_url="https://pixabay.com/service/license-summary/",
                )
            )
        return out
