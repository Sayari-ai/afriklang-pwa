# Image-sourcing script

Sources, filters, dedupes, transforms and uploads 800 images for the
Afriklang 20-path content catalogue.

## Layout
```
scripts/
  source_images.py          # CLI entrypoint
  config.py                 # Env + constants
  providers/
    __init__.py             # Provider chain
    base.py                 # Provider protocol + Candidate dataclass
    pexels.py
    unsplash.py
    pixabay.py
    wikimedia.py
  filters/
    license.py              # CC / royalty-free predicate
    quality.py              # min resolution + aspect ratio
    dedupe.py               # imagehash perceptual dedupe (per-run state)
  pipeline/
    download.py
    transform.py            # resize -> JPEG q82
    upload_supabase.py
    ledger.py               # CSV ledger + ATTRIBUTIONS.md + review HTML
  requirements.txt
```

## Setup
```bash
cd scripts
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create `.env` (or export in shell):
```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role>
SUPABASE_BUCKET=levels
PEXELS_API_KEY=...
UNSPLASH_ACCESS_KEY=...
PIXABAY_API_KEY=...
# Wikimedia needs no key.
```

## Usage
```bash
# Dry run on Path 1 only (no uploads, just download + filter + review HTML).
python source_images.py \
  --catalogue ../docs/content/paths_catalogue.csv \
  --out ../docs/content/paths_catalogue.enriched.csv \
  --only-path 1 \
  --dry-run

# Full run, resumable.
python source_images.py \
  --catalogue ../docs/content/paths_catalogue.csv \
  --out ../docs/content/paths_catalogue.enriched.csv \
  --resume
```

## Output artifacts
- `paths_catalogue.enriched.csv`: original rows + `image_url`, `image_path`,
  `source_provider`, `source_id`, `source_attribution`, `downloaded_at`.
- `docs/content/ATTRIBUTIONS.md`: machine-generated credits.
- `scripts/work/review/p{NN}.html`: thumbnail grids for manual QC.
- `scripts/work/cache/`: downloaded originals (kept for `--resume`).
- `scripts/work/processed/`: transformed JPEGs uploaded to Storage.
- `scripts/work/ledger.json`: phash registry + per-row state for `--resume`.

## Loading enriched rows into Supabase

Once `source_images.py` has produced `paths_catalogue.enriched.csv` (without
`--dry-run` so the URLs are real Supabase Storage URLs), bulk-load the rows
into the `path_questions` table:

```bash
# Validate first (no DB writes):
python tools/load_path_questions.py \
  --enriched ../docs/content/paths_catalogue.enriched.csv \
  --dry-run

# Real upsert (idempotent on (path_id, level_id, q_index)):
python tools/load_path_questions.py \
  --enriched ../docs/content/paths_catalogue.enriched.csv
```

Flags:
- `--only-path N` — load just one path.
- `--allow-file-urls` — permit `file://` URLs (only useful for offline
  staging tests; production rows must be public https URLs).

The loader refuses to write `file://` URLs by default so you can't
accidentally seed the DB from a `--dry-run` sourcing pass.

## Resume semantics
A row is "done" when `image_url` exists in the enriched CSV AND the file
exists in Supabase Storage (verified on resume by HEAD). Otherwise it
will be re-attempted, with the existing perceptual-hash registry still
preventing duplicate selections across the whole run.
