"""Backfill images for rows that source_images.py left empty.

After running source_images.py against the full catalogue we ended up with
seven rows whose verb-driven prompts matched nothing on Pexels / Pixabay
and whose original wording also returned nothing on Wikimedia Commons.

This script targets only those rows, with a hand-curated query override
per row that we have empirically verified returns clean Wikimedia hits.
It reuses the regular pipeline (license filter -> download -> transform
-> upload -> ledger -> CSV) so the result is indistinguishable from a
normal source_images.py run.

Usage:
    python tools/backfill_missing_wikimedia.py \\
        --catalogue ../docs/content/paths_catalogue.csv \\
        --out ../docs/content/paths_catalogue.enriched.csv

The script is idempotent: rows that already have an https:// image_url
are skipped. Run it as many times as you like.
"""
from __future__ import annotations

import argparse
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Allow `python tools/backfill_missing_wikimedia.py` from scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd  # noqa: E402

from config import Env, LEDGER_PATH, PROCESSED_DIR  # noqa: E402
from filters import (  # noqa: E402
    Deduper,
    is_candidate_quality_ok,
    is_image_quality_ok,
    is_license_acceptable,
)
from pipeline import (  # noqa: E402
    Ledger,
    SupabaseUploader,
    download_to_cache,
    transform_to_jpeg,
)
from providers.wikimedia import WikimediaProvider  # noqa: E402


# Hand-curated query overrides. Each entry maps the missing row's
# (path_id, level_id, q_index) to a Wikimedia-friendly query. We
# probed each of these manually before encoding them here.
QUERY_OVERRIDES: dict[tuple[int, int, int], str] = {
    # p14/L3/q1 — A grandmother passing a tray of food
    (14, 3, 1): "grandmother food tray",
    # p14/L5/q7 — A woman shaking out a rug from a balcony
    (14, 5, 7): "woman cleaning rug",
    # p15/L3/q1 — A grandfather pointing at a photo album
    (15, 3, 1): "grandfather memories photographs",
    # p15/L7/q3 — Children riding decorated bicycles in a parade
    (15, 7, 3): "children bicycle parade",
    # p17/L3/q4 — A father teaching his son to drive
    (17, 3, 4): "driving lesson",
    # p19/L6/q3 — A storm rolling over a coastal city
    (19, 6, 3): "storm coastal city",
    # p20/L2/q2 — A tongue tasting a spoon
    (20, 2, 2): "tongue tasting",
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--catalogue", required=True, type=Path,
                   help="Source catalogue CSV (used only to derive prompts).")
    p.add_argument(
        "--out",
        required=True,
        type=Path,
        help="Enriched CSV to update in place.",
    )
    p.add_argument("--per-page", type=int, default=10)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip Supabase upload; surface the local processed JPEG only.",
    )
    return p.parse_args(argv)


def _format_attribution(meta: dict) -> str:
    photographer = meta.get("photographer") or "Unknown"
    license_label = meta.get("license") or ""
    page = meta.get("source_page_url") or ""
    return f"{photographer} — {license_label} — {page}".strip(" —")


def backfill_row(
    *,
    path_id: int,
    level_id: int,
    q_index: int,
    query: str,
    provider: WikimediaProvider,
    ledger: Ledger,
    deduper: Deduper,
    uploader: SupabaseUploader | None,
    per_page: int,
) -> dict | None:
    """Source one image for the given row from Wikimedia.

    Returns the enriched columns dict on success, or None on failure. The
    ledger is updated either way.
    """
    print(
        f"\n[p{path_id:02d}/L{level_id}/q{q_index}] backfill query: {query!r}",
        flush=True,
    )

    try:
        candidates = provider.search(query, per_page=per_page)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! provider search failed: {exc}", file=sys.stderr)
        ledger.mark_failed(path_id, level_id, q_index, f"search failed: {exc}")
        ledger.save()
        return None

    print(f"  -> {len(candidates)} candidates")
    last_error: str | None = None

    for candidate in candidates:
        if not is_license_acceptable(candidate.license):
            last_error = f"license filter: {candidate.license}"
            continue
        if not is_candidate_quality_ok(candidate):
            last_error = "candidate quality (size) filter"
            continue

        try:
            cached = download_to_cache(candidate.download_url)
        except Exception as exc:  # noqa: BLE001
            last_error = f"download failed: {exc}"
            continue

        if not is_image_quality_ok(cached):
            last_error = "post-download quality check failed"
            continue

        try:
            phash = Deduper.compute(cached)
        except Exception as exc:  # noqa: BLE001
            last_error = f"phash failed: {exc}"
            continue

        if deduper.is_duplicate(phash):
            last_error = "duplicate image"
            continue

        try:
            processed = transform_to_jpeg(
                cached,
                path_id=path_id,
                level_id=level_id,
                q_index=q_index,
            )
        except Exception as exc:  # noqa: BLE001
            last_error = f"transform failed: {exc}"
            continue

        if uploader is not None:
            try:
                public_url = uploader.upload(
                    processed,
                    path_id=path_id,
                    level_id=level_id,
                    q_index=q_index,
                )
            except Exception as exc:  # noqa: BLE001
                last_error = f"upload failed: {exc}"
                continue
        else:
            public_url = processed.resolve().as_uri()

        deduper.register(phash)
        image_path = f"paths/p{path_id:02d}/L{level_id}_q{q_index}.jpg"
        ledger.mark_done(
            path_id=path_id,
            level_id=level_id,
            q_index=q_index,
            image_url=public_url,
            image_path=image_path,
            provider=provider.name,
            source_id=candidate.source_id,
            source_page_url=candidate.source_page_url,
            license_label=candidate.license,
            license_url=candidate.license_url,
            photographer=candidate.photographer,
            phash=phash,
        )
        ledger.save()

        print(f"  OK -> {public_url}")
        return {
            "image_url": public_url,
            "image_path": image_path,
            "source_provider": provider.name,
            "source_id": candidate.source_id,
            "source_attribution": _format_attribution({
                "photographer": candidate.photographer,
                "license": candidate.license,
                "license_url": candidate.license_url,
                "source_page_url": candidate.source_page_url,
            }),
            "downloaded_at": ledger.get(path_id, level_id, q_index).downloaded_at
                or datetime.now(timezone.utc).isoformat(),
        }

    print(f"  FAILED -> {last_error or 'no acceptable candidate'}", file=sys.stderr)
    ledger.mark_failed(path_id, level_id, q_index, last_error or "no acceptable candidate")
    ledger.save()
    return None


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    env = Env.load()

    if not args.out.exists():
        raise SystemExit(f"Enriched CSV not found: {args.out}")

    df = pd.read_csv(args.out)
    # Coerce columns we may write strings to: pandas infers numeric dtypes
    # from the existing rows (e.g. source_id from Pexels is all-int), which
    # then refuses string assignments like Wikimedia's pageid-as-str. Force
    # to object up-front so .at[] assignments always succeed.
    for col in (
        "image_url",
        "image_path",
        "source_provider",
        "source_id",
        "source_attribution",
        "downloaded_at",
    ):
        if col in df.columns:
            df[col] = df[col].astype(object)

    uploader: SupabaseUploader | None = None
    if not args.dry_run:
        if not (env.supabase_url and env.supabase_service_role_key):
            print("Supabase env missing; pass --dry-run or set "
                  "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
            return 2
        uploader = SupabaseUploader(
            env.supabase_url, env.supabase_service_role_key, env.supabase_bucket
        )

    provider = WikimediaProvider()
    ledger = Ledger(LEDGER_PATH)
    deduper = Deduper(ledger.all_phashes())

    enriched_cols = [
        "image_url",
        "image_path",
        "source_provider",
        "source_id",
        "source_attribution",
        "downloaded_at",
    ]

    targets = list(QUERY_OVERRIDES.items())
    print(f"Backfill targets: {len(targets)} rows")

    successes = 0
    failures: list[tuple[int, int, int]] = []
    for (path_id, level_id, q_index), query in targets:
        # Idempotency: skip if the row already has a real https URL.
        mask = (
            (df["path_id"] == path_id)
            & (df["level_id"] == level_id)
            & (df["q_index"] == q_index)
        )
        matches = df.index[mask].tolist()
        if not matches:
            print(f"  ! row p{path_id:02d}/L{level_id}/q{q_index} not in CSV; skipping",
                  file=sys.stderr)
            continue
        row_idx = matches[0]
        existing = df.at[row_idx, "image_url"]
        if isinstance(existing, str) and existing.startswith("https://"):
            print(f"[p{path_id:02d}/L{level_id}/q{q_index}] already has https URL; "
                  f"skipping")
            successes += 1
            continue

        try:
            result = backfill_row(
                path_id=path_id,
                level_id=level_id,
                q_index=q_index,
                query=query,
                provider=provider,
                ledger=ledger,
                deduper=deduper,
                uploader=uploader,
                per_page=args.per_page,
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            failures.append((path_id, level_id, q_index))
            ledger.mark_failed(path_id, level_id, q_index, str(exc))
            ledger.save()
            continue

        if not result:
            failures.append((path_id, level_id, q_index))
            continue

        for col in enriched_cols:
            df.at[row_idx, col] = result.get(col)
        successes += 1

    df.to_csv(args.out, index=False)
    print(f"\nWrote enriched catalogue: {args.out}")
    print(f"Successes: {successes}/{len(targets)}")
    if failures:
        print("Failures:")
        for p, l, q in failures:
            print(f"  p{p:02d}/L{l}/q{q}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
