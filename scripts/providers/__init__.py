"""Provider chain entrypoint."""
from __future__ import annotations

from typing import Iterable

from .base import Candidate, Provider
from .pexels import PexelsProvider
from .pixabay import PixabayProvider
from .unsplash import UnsplashProvider
from .wikimedia import WikimediaProvider

__all__ = [
    "Candidate",
    "Provider",
    "build_provider_chain",
]


def build_provider_chain(env, order: Iterable[str]) -> list[Provider]:
    """Return the configured provider chain in priority order.

    Providers without their required API key are silently skipped so the
    pipeline can still run (e.g. Wikimedia-only fallback mode for offline
    authoring environments).
    """

    factories = {
        "pexels": lambda: PexelsProvider(env.pexels_api_key) if env.pexels_api_key else None,
        "unsplash": lambda: UnsplashProvider(env.unsplash_access_key) if env.unsplash_access_key else None,
        "pixabay": lambda: PixabayProvider(env.pixabay_api_key) if env.pixabay_api_key else None,
        "wikimedia": lambda: WikimediaProvider(),
    }

    chain: list[Provider] = []
    for name in order:
        factory = factories.get(name)
        if factory is None:
            continue
        provider = factory()
        if provider is not None:
            chain.append(provider)
    return chain
