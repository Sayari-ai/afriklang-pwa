"""Wikimedia Commons provider.

Docs: https://commons.wikimedia.org/w/api.php
License: Per-file (most are CC BY-SA / CC BY / public domain).

We use the MediaWiki API "generator=search" to find files in the File:
namespace, then fetch imageinfo with extmetadata to get license + author.
"""
from __future__ import annotations

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from .base import Candidate

API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "AfriklangContentBot/0.1 (https://afriklang.example; contact@afriklang.example)"


def _strip_html(value: str | None) -> str | None:
    if value is None:
        return None
    # MediaWiki extmetadata often returns simple HTML; do a coarse strip.
    import re

    return re.sub(r"<[^>]+>", "", value).strip() or None


class WikimediaProvider:
    name = "wikimedia"

    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": USER_AGENT})

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
    def search(self, query: str, *, per_page: int = 10) -> list[Candidate]:
        params = {
            "action": "query",
            "format": "json",
            "generator": "search",
            "gsrsearch": f"{query} filetype:bitmap",
            "gsrlimit": per_page,
            "gsrnamespace": 6,  # File:
            "prop": "imageinfo",
            "iiprop": "url|size|extmetadata|user",
            "iiurlwidth": 1600,
        }
        resp = self._session.get(API, params=params, timeout=20)
        resp.raise_for_status()
        pages = (resp.json().get("query") or {}).get("pages") or {}

        out: list[Candidate] = []
        for page in pages.values():
            infos = page.get("imageinfo") or []
            if not infos:
                continue
            info = infos[0]
            url = info.get("thumburl") or info.get("url")
            if not url:
                continue
            meta = info.get("extmetadata") or {}
            license_short = _strip_html((meta.get("LicenseShortName") or {}).get("value"))
            license_url = (meta.get("LicenseUrl") or {}).get("value")
            author = _strip_html((meta.get("Artist") or {}).get("value"))
            out.append(
                Candidate(
                    provider=self.name,
                    source_id=str(page.get("pageid")),
                    download_url=url,
                    width=int(info.get("thumbwidth") or info.get("width") or 0),
                    height=int(info.get("thumbheight") or info.get("height") or 0),
                    photographer=author,
                    source_page_url=info.get("descriptionurl") or "",
                    license=license_short or "See source",
                    license_url=license_url,
                )
            )
        return out
