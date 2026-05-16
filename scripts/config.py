"""Central config: env, paths, provider order, transform params."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass


SCRIPT_DIR = Path(__file__).resolve().parent
WORK_DIR = SCRIPT_DIR / "work"
CACHE_DIR = WORK_DIR / "cache"
PROCESSED_DIR = WORK_DIR / "processed"
REVIEW_DIR = WORK_DIR / "review"
LEDGER_PATH = WORK_DIR / "ledger.json"

for d in (WORK_DIR, CACHE_DIR, PROCESSED_DIR, REVIEW_DIR):
    d.mkdir(parents=True, exist_ok=True)


# Provider order: try free/permissive first, then commercial-licensed APIs,
# then Wikimedia as a wildcard for nouns + cultural concepts.
PROVIDER_ORDER = ("pexels", "unsplash", "pixabay", "wikimedia")

# Transform params.
TARGET_WIDTH = 1600
JPEG_QUALITY = 82
MIN_SOURCE_WIDTH = 1200
MIN_ASPECT = 0.7   # taller than this is fine (portrait OK down to 7:10)
MAX_ASPECT = 2.2   # wider than this gets rejected

# Dedupe.
PHASH_HAMMING_THRESHOLD = 6  # 0..64; <=6 considered duplicate


@dataclass(frozen=True)
class Env:
    supabase_url: str | None
    supabase_service_role_key: str | None
    supabase_bucket: str
    pexels_api_key: str | None
    unsplash_access_key: str | None
    pixabay_api_key: str | None

    @classmethod
    def load(cls) -> "Env":
        return cls(
            supabase_url=os.getenv("SUPABASE_URL"),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
            supabase_bucket=os.getenv("SUPABASE_BUCKET", "levels"),
            pexels_api_key=os.getenv("PEXELS_API_KEY"),
            unsplash_access_key=os.getenv("UNSPLASH_ACCESS_KEY"),
            pixabay_api_key=os.getenv("PIXABAY_API_KEY"),
        )
