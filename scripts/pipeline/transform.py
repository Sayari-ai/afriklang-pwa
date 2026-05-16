"""Resize to TARGET_WIDTH, encode JPEG q82, strip EXIF."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps

from config import JPEG_QUALITY, PROCESSED_DIR, TARGET_WIDTH


def transform_to_jpeg(source: Path, *, path_id: int, level_id: int, q_index: int) -> Path:
    """Produce processed JPEG at processed/p{NN}_L{L}_q{Q}.jpg."""
    out_name = f"p{path_id:02d}_L{level_id}_q{q_index}.jpg"
    out_path = PROCESSED_DIR / out_name

    with Image.open(source) as im:
        # Apply EXIF orientation, then drop EXIF in the output.
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        elif im.mode == "L":
            im = im.convert("RGB")

        w, h = im.size
        if w > TARGET_WIDTH:
            new_h = round(h * (TARGET_WIDTH / w))
            im = im.resize((TARGET_WIDTH, new_h), Image.LANCZOS)

        im.save(
            out_path,
            format="JPEG",
            quality=JPEG_QUALITY,
            optimize=True,
            progressive=True,
        )
    return out_path
