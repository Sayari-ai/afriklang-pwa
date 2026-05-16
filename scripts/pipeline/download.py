"""HTTP download with retry, content-type guard, atomic write."""
from __future__ import annotations

import hashlib
from pathlib import Path

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from config import CACHE_DIR

USER_AGENT = "AfriklangContentBot/0.1 (+contact@afriklang.example)"


def _cache_path_for(url: str, suggested_ext: str = ".bin") -> Path:
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    return CACHE_DIR / f"{digest}{suggested_ext}"


def _ext_from_content_type(ct: str | None) -> str:
    if not ct:
        return ".bin"
    ct = ct.split(";")[0].strip().lower()
    return {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }.get(ct, ".bin")


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
def download_to_cache(url: str) -> Path:
    """Stream the URL into the cache directory and return the file path.

    Idempotent on URL: if a cached copy exists, returns it without redownload.
    """
    # Quick resolve based on URL alone — but we don't know content-type yet,
    # so first do a HEAD-ish probe via streamed GET.
    with requests.get(url, stream=True, timeout=30, headers={"User-Agent": USER_AGENT}) as resp:
        resp.raise_for_status()
        ct = resp.headers.get("Content-Type")
        ext = _ext_from_content_type(ct)
        path = _cache_path_for(url, ext)
        if path.exists() and path.stat().st_size > 1024:
            return path
        tmp = path.with_suffix(path.suffix + ".part")
        with tmp.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=64 * 1024):
                if chunk:
                    fh.write(chunk)
        tmp.replace(path)
    return path
