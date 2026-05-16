"""Bulk-load enriched path catalogue into Supabase `path_questions`.

Reads `paths_catalogue.enriched.csv` (output of source_images.py) and
upserts every row with a non-empty `image_url` and `image_path` into the
public.path_questions table. The composite primary key
(path_id, level_id, q_index) makes the operation idempotent.

Usage:
    python tools/load_path_questions.py \\
        --enriched ../docs/content/paths_catalogue.enriched.csv

Add --dry-run to print the row count and a sample without hitting
Supabase. Add --only-path N to filter to a single path. The script
refuses to upload rows whose image_url is a file:// URI (i.e. came
from a --dry-run sourcing pass) so you cannot accidentally seed the DB
with local-only paths.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from pathlib import Path

# Make sibling `config` importable when run as `python tools/load_path_questions.py`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import Env  # noqa: E402

try:
    from supabase import create_client  # noqa: E402
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "supabase-py not installed. Run `pip install -r requirements.txt`."
    ) from exc


REQUIRED_COLUMNS = (
    "path_id",
    "level_id",
    "q_index",
    "theme",
    "prompt_en",
    "image_url",
    "image_path",
)

UPSERT_BATCH_SIZE = 200


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--enriched", required=True, type=Path,
                   help="paths_catalogue.enriched.csv produced by source_images.py")
    p.add_argument("--only-path", type=int, default=None)
    p.add_argument("--dry-run", action="store_true",
                   help="Validate + summarize only; do not write to Supabase.")
    p.add_argument("--allow-file-urls", action="store_true",
                   help="Permit file:// URLs (only for offline staging tests).")
    return p.parse_args(argv)


def load_rows(path: Path, only_path: int | None) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"Enriched CSV not found: {path}")

    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"Enriched CSV missing columns: {missing}")
        rows = list(reader)

    if only_path is not None:
        rows = [r for r in rows if int(r["path_id"]) == only_path]
    return rows


def filter_loadable(rows: list[dict], allow_file_urls: bool) -> tuple[list[dict], dict[str, int]]:
    skipped = {"no_image_url": 0, "no_image_path": 0, "file_url": 0}
    out: list[dict] = []
    for r in rows:
        url = (r.get("image_url") or "").strip()
        ipath = (r.get("image_path") or "").strip()
        if not url:
            skipped["no_image_url"] += 1
            continue
        if not ipath:
            skipped["no_image_path"] += 1
            continue
        if url.startswith("file://") and not allow_file_urls:
            skipped["file_url"] += 1
            continue
        out.append(r)
    return out, skipped


def to_record(row: dict) -> dict:
    return {
        "path_id": int(row["path_id"]),
        "level_id": int(row["level_id"]),
        "q_index": int(row["q_index"]),
        "theme": row["theme"],
        "prompt_en": row["prompt_en"],
        "image_url": row["image_url"].strip(),
        "image_path": row["image_path"].strip(),
    }


def chunked(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    env = Env.load()

    rows = load_rows(args.enriched, args.only_path)
    print(f"Read {len(rows)} rows from {args.enriched}")

    loadable, skipped = filter_loadable(rows, args.allow_file_urls)
    print(
        f"Loadable: {len(loadable)} | "
        f"skipped no_image_url={skipped['no_image_url']}, "
        f"no_image_path={skipped['no_image_path']}, "
        f"file_url={skipped['file_url']}"
    )

    if not loadable:
        print("Nothing to upload.", file=sys.stderr)
        return 1

    records = [to_record(r) for r in loadable]

    # Per-path coverage summary.
    from collections import Counter
    by_path = Counter(r["path_id"] for r in records)
    print("Per-path coverage:")
    for pid in sorted(by_path):
        marker = "OK" if by_path[pid] == 40 else "PARTIAL"
        print(f"  Path {pid:2d}: {by_path[pid]}/40  [{marker}]")

    if args.dry_run:
        print("\n--dry-run: showing 3 sample records, not writing.")
        for r in records[:3]:
            print(f"  {r}")
        return 0

    if not (env.supabase_url and env.supabase_service_role_key):
        raise SystemExit(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (set in scripts/.env)."
        )

    client = create_client(env.supabase_url, env.supabase_service_role_key)
    table = client.schema("public").table("path_questions")

    total = 0
    for batch in chunked(records, UPSERT_BATCH_SIZE):
        # supabase-py 2.x: upsert auto-detects conflict via primary key.
        resp = table.upsert(batch).execute()
        # `data` is a list when the call succeeds.
        n = len(resp.data) if getattr(resp, "data", None) is not None else len(batch)
        total += n
        print(f"  upserted batch of {n} (running total {total})")

    print(f"Done. {total} rows in path_questions.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
