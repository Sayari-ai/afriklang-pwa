"""License acceptance check.

Whitelists the four provider licenses we use. For Wikimedia (which varies
per file), we accept anything that looks like CC0/CC BY/CC BY-SA/Public
domain — and reject NoDerivs / NonCommercial.
"""
from __future__ import annotations

ACCEPTED_FIXED = {
    "Pexels License",
    "Unsplash License",
    "Pixabay Content License",
}

REJECT_TOKENS = ("nd", "nc", "noncommercial", "noderivs", "no derivatives")


def is_license_acceptable(license_label: str) -> bool:
    if not license_label:
        return False
    if license_label in ACCEPTED_FIXED:
        return True

    label = license_label.lower()
    if any(tok in label for tok in REJECT_TOKENS):
        return False
    return any(
        tok in label
        for tok in ("cc0", "public domain", "cc by", "creative commons")
    )
