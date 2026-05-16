"""CLI entrypoint: source images for the catalogue.

Usage:
    python source_images.py --catalogue ../docs/content/paths_catalogue.csv \\
                            --out      ../docs/content/paths_catalogue.enriched.csv \\
                            [--only-path N] [--resume] [--dry-run]
"""
from __future__ import annotations

import argparse
import sys
import traceback
from pathlib import Path
from typing import Iterable

import pandas as pd
from tqdm import tqdm

from config import (
    Env,
    LEDGER_PATH,
    PROCESSED_DIR,
    PROVIDER_ORDER,
    REVIEW_DIR,
)
from filters import (
    Deduper,
    is_candidate_quality_ok,
    is_image_quality_ok,
    is_license_acceptable,
)
from pipeline import (
    Ledger,
    SupabaseUploader,
    download_to_cache,
    transform_to_jpeg,
)
from providers import build_provider_chain
from providers.base import Candidate
from reports import write_attributions_md, write_review_html


REQUIRED_COLUMNS = (
    "path_id",
    "level_id",
    "q_index",
    "prompt_en",
    "search_query",
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Source images for path catalogue")
    p.add_argument("--catalogue", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--only-path", type=int, default=None)
    p.add_argument("--resume", action="store_true")
    p.add_argument("--dry-run", action="store_true",
                   help="Skip Supabase upload; populate ledger + review HTML only.")
    p.add_argument("--per-page", type=int, default=10)
    return p.parse_args(argv)


def load_catalogue(path: Path, only_path: int | None) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise SystemExit(f"Catalogue missing columns: {missing}")
    if only_path is not None:
        df = df[df.path_id == only_path].copy()
    return df.reset_index(drop=True)


def gather_candidates(providers, query: str, per_page: int) -> Iterable[tuple[object, Candidate]]:
    """Yield (provider, candidate) pairs from each provider in priority order."""
    for provider in providers:
        try:
            results = provider.search(query, per_page=per_page)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {provider.name} search failed: {exc}", file=sys.stderr)
            continue
        for candidate in results:
            yield provider, candidate


def process_row(
    *,
    row: pd.Series,
    providers: list,
    ledger: Ledger,
    deduper: Deduper,
    uploader: SupabaseUploader | None,
    per_page: int,
    resume: bool,
) -> dict:
    path_id = int(row.path_id)
    level_id = int(row.level_id)
    q_index = int(row.q_index)
    query = str(row.search_query).strip()

    existing = ledger.get(path_id, level_id, q_index)
    # Only honour the resume short-circuit when the stored URL is a real
    # public https URL — a `file://` URL means an earlier dry run wrote
    # the ledger but never uploaded.
    if (
        resume
        and existing.status == "done"
        and existing.image_url
        and existing.image_url.startswith("https://")
    ):
        return {
            "image_url": existing.image_url,
            "image_path": existing.image_path,
            "source_provider": existing.provider,
            "source_id": existing.source_id,
            "source_attribution": _format_attribution(existing.__dict__),
            "downloaded_at": existing.downloaded_at,
        }

    # Fast path: a previous (dry) run already produced the processed JPEG
    # locally and recorded full provenance in the ledger. We just need to
    # upload that file and rewrite the ledger URL — no provider call,
    # no re-download, no re-dedupe.
    processed_local = PROCESSED_DIR / f"p{path_id:02d}_L{level_id}_q{q_index}.jpg"
    if (
        uploader is not None
        and processed_local.exists()
        and existing.provider
        and existing.source_id
        and existing.phash
    ):
        try:
            public_url = uploader.upload(
                processed_local,
                path_id=path_id,
                level_id=level_id,
                q_index=q_index,
            )
        except Exception as exc:  # noqa: BLE001
            # Fall through to full provider chain on upload failure.
            print(
                f"  ! upload-only fast path failed for "
                f"p{path_id:02d}_L{level_id}_q{q_index}: {exc}",
                file=sys.stderr,
            )
        else:
            image_path = f"paths/p{path_id:02d}/L{level_id}_q{q_index}.jpg"
            ledger.mark_done(
                path_id=path_id,
                level_id=level_id,
                q_index=q_index,
                image_url=public_url,
                image_path=image_path,
                provider=existing.provider,
                source_id=existing.source_id,
                source_page_url=existing.source_page_url or "",
                license_label=existing.license or "",
                license_url=existing.license_url,
                photographer=existing.photographer,
                phash=existing.phash,
            )
            ledger.save()
            return {
                "image_url": public_url,
                "image_path": image_path,
                "source_provider": existing.provider,
                "source_id": existing.source_id,
                "source_attribution": _format_attribution(
                    {
                        "photographer": existing.photographer,
                        "license": existing.license,
                        "license_url": existing.license_url,
                        "source_page_url": existing.source_page_url,
                    }
                ),
                "downloaded_at": ledger.get(path_id, level_id, q_index).downloaded_at,
            }

    last_error: str | None = None
    for provider, candidate in gather_candidates(providers, query, per_page):
        if not is_license_acceptable(candidate.license):
            continue
        if not is_candidate_quality_ok(candidate):
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
            # Dry run: surface the local processed path as a file:// URL.
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

        return {
            "image_url": public_url,
            "image_path": image_path,
            "source_provider": provider.name,
            "source_id": candidate.source_id,
            "source_attribution": _format_attribution(
                {
                    "photographer": candidate.photographer,
                    "license": candidate.license,
                    "license_url": candidate.license_url,
                    "source_page_url": candidate.source_page_url,
                }
            ),
            "downloaded_at": ledger.get(path_id, level_id, q_index).downloaded_at,
        }

    ledger.mark_failed(path_id, level_id, q_index, last_error or "no acceptable candidate")
    ledger.save()
    return {
        "image_url": None,
        "image_path": None,
        "source_provider": None,
        "source_id": None,
        "source_attribution": None,
        "downloaded_at": None,
    }


def _format_attribution(meta: dict) -> str:
    photographer = meta.get("photographer") or "Unknown"
    license_label = meta.get("license") or ""
    page = meta.get("source_page_url") or ""
    return f"{photographer} — {license_label} — {page}".strip(" —")


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    env = Env.load()

    providers = build_provider_chain(env, PROVIDER_ORDER)
    if not providers:
        print("No providers configured. Add at least one API key.", file=sys.stderr)
        return 2
    print("Providers:", ", ".join(p.name for p in providers))

    uploader: SupabaseUploader | None = None
    if not args.dry_run:
        if not (env.supabase_url and env.supabase_service_role_key):
            print("Supabase env missing; pass --dry-run or set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
            return 2
        uploader = SupabaseUploader(
            env.supabase_url, env.supabase_service_role_key, env.supabase_bucket
        )

    df = load_catalogue(args.catalogue, args.only_path)
    print(f"Catalogue: {len(df)} rows from {args.catalogue}")

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
    for col in enriched_cols:
        if col not in df.columns:
            df[col] = None

    iterator = tqdm(df.itertuples(index=True), total=len(df), desc="Sourcing")
    failures = 0
    for row in iterator:
        try:
            result = process_row(
                row=row,
                providers=providers,
                ledger=ledger,
                deduper=deduper,
                uploader=uploader,
                per_page=args.per_page,
                resume=args.resume,
            )
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            failures += 1
            ledger.mark_failed(int(row.path_id), int(row.level_id), int(row.q_index), str(exc))
            ledger.save()
            continue
        if not result.get("image_url"):
            failures += 1
        for col in enriched_cols:
            df.at[row.Index, col] = result.get(col)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print(f"Wrote enriched catalogue: {args.out}")

    review_pages = write_review_html(ledger, REVIEW_DIR)
    print(f"Review HTML pages: {len(review_pages)} (in {REVIEW_DIR})")

    attributions_path = args.out.parent / "ATTRIBUTIONS.md"
    write_attributions_md(ledger, attributions_path)
    print(f"Attributions: {attributions_path}")

    print(f"Done. Failures: {failures}/{len(df)}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
