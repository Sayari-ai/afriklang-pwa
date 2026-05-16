"""Supabase Storage uploader.

Uses the Storage REST API directly via httpx instead of the supabase-py
storage client, which in some 2.x releases mis-builds the base URL
(`/rest/v1/storage/v1/...` instead of `/storage/v1/...`) and produces
opaque "'dict' object has no attribute 'text'" errors on any non-2xx
response.

Bucket must already exist (public read).
"""
from __future__ import annotations

from pathlib import Path

import httpx


class SupabaseUploader:
    def __init__(self, url: str, service_role_key: str, bucket: str) -> None:
        self._base = url.rstrip("/")
        self._key = service_role_key
        self._bucket = bucket
        self._client = httpx.Client(
            timeout=httpx.Timeout(60.0, connect=15.0),
            headers={
                "Authorization": f"Bearer {service_role_key}",
                "apikey": service_role_key,
            },
        )

    def upload(
        self, local_path: Path, *, path_id: int, level_id: int, q_index: int
    ) -> str:
        remote_path = f"paths/p{path_id:02d}/L{level_id}_q{q_index}.jpg"
        upload_url = (
            f"{self._base}/storage/v1/object/{self._bucket}/{remote_path}"
        )

        with local_path.open("rb") as fh:
            data = fh.read()

        # POST = create, PUT = update. We use POST + x-upsert: true so the
        # call is idempotent across re-runs.
        resp = self._client.post(
            upload_url,
            content=data,
            headers={
                "Content-Type": "image/jpeg",
                "Cache-Control": "public, max-age=2592000",
                "x-upsert": "true",
            },
        )
        if resp.status_code >= 300:
            raise RuntimeError(
                f"upload {resp.status_code} for {remote_path}: {resp.text[:300]}"
            )

        return (
            f"{self._base}/storage/v1/object/public/{self._bucket}/{remote_path}"
        )

    def close(self) -> None:
        self._client.close()
