"""Resolution + aspect-ratio quality gates."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

from config import MAX_ASPECT, MIN_ASPECT, MIN_SOURCE_WIDTH
from providers.base import Candidate


def is_candidate_quality_ok(candidate: Candidate) -> bool:
    """Cheap pre-download check from provider-reported metadata."""
    if candidate.width and candidate.width < MIN_SOURCE_WIDTH:
        return False
    if candidate.width and candidate.height:
        aspect = candidate.width / candidate.height
        if aspect < MIN_ASPECT or aspect > MAX_ASPECT:
            return False
    return True


def is_image_quality_ok(path: Path) -> bool:
    """Post-download check on the actual decoded pixels."""
    try:
        with Image.open(path) as im:
            w, h = im.size
    except Exception:
        return False
    if w < MIN_SOURCE_WIDTH:
        return False
    aspect = w / h
    if aspect < MIN_ASPECT or aspect > MAX_ASPECT:
        return False
    return True
