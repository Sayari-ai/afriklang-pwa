"""JSON-backed ledger for resume + dedupe + attribution.

Schema v1:
{
  "version": 1,
  "phashes": ["<hex>", ...],
  "rows": {
    "<path_id>:<level_id>:<q_index>": {
      "status": "done" | "failed" | "pending",
      "image_url": "...",
      "image_path": "paths/p01/L1_q1.jpg",
      "provider": "pexels",
      "source_id": "12345",
      "source_page_url": "https://...",
      "license": "Pexels License",
      "license_url": "https://...",
      "photographer": "Jane Doe",
      "phash": "<hex>",
      "downloaded_at": "2026-05-01T12:34:56Z",
      "error": null
    },
    ...
  }
}
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import LEDGER_PATH


def _row_key(path_id: int, level_id: int, q_index: int) -> str:
    return f"{path_id}:{level_id}:{q_index}"


@dataclass
class RowState:
    status: str = "pending"  # pending | done | failed
    image_url: str | None = None
    image_path: str | None = None
    provider: str | None = None
    source_id: str | None = None
    source_page_url: str | None = None
    license: str | None = None
    license_url: str | None = None
    photographer: str | None = None
    phash: str | None = None
    downloaded_at: str | None = None
    error: str | None = None


@dataclass
class _State:
    version: int = 1
    phashes: list[str] = field(default_factory=list)
    rows: dict[str, dict[str, Any]] = field(default_factory=dict)


class Ledger:
    """Mutable ledger with periodic save + atomic rewrite."""

    def __init__(self, path: Path = LEDGER_PATH) -> None:
        self._path = path
        self._state = self._load()

    # ---- IO -----------------------------------------------------------
    def _load(self) -> _State:
        if not self._path.exists():
            return _State()
        try:
            raw = json.loads(self._path.read_text("utf-8"))
        except json.JSONDecodeError:
            return _State()
        return _State(
            version=int(raw.get("version", 1)),
            phashes=list(raw.get("phashes", [])),
            rows=dict(raw.get("rows", {})),
        )

    def save(self) -> None:
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        tmp.write_text(json.dumps(asdict(self._state), indent=2), "utf-8")
        tmp.replace(self._path)

    # ---- API ----------------------------------------------------------
    def all_phashes(self) -> list[str]:
        return list(self._state.phashes)

    def remember_phash(self, phash_hex: str) -> None:
        if phash_hex and phash_hex not in self._state.phashes:
            self._state.phashes.append(phash_hex)

    def get(self, path_id: int, level_id: int, q_index: int) -> RowState:
        key = _row_key(path_id, level_id, q_index)
        raw = self._state.rows.get(key)
        if raw is None:
            return RowState()
        return RowState(**{k: raw.get(k) for k in RowState.__dataclass_fields__})

    def set(self, path_id: int, level_id: int, q_index: int, row: RowState) -> None:
        key = _row_key(path_id, level_id, q_index)
        self._state.rows[key] = asdict(row)

    def mark_done(
        self,
        *,
        path_id: int,
        level_id: int,
        q_index: int,
        image_url: str,
        image_path: str,
        provider: str,
        source_id: str,
        source_page_url: str,
        license_label: str,
        license_url: str | None,
        photographer: str | None,
        phash: str,
    ) -> None:
        self.set(
            path_id,
            level_id,
            q_index,
            RowState(
                status="done",
                image_url=image_url,
                image_path=image_path,
                provider=provider,
                source_id=source_id,
                source_page_url=source_page_url,
                license=license_label,
                license_url=license_url,
                photographer=photographer,
                phash=phash,
                downloaded_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                error=None,
            ),
        )
        self.remember_phash(phash)

    def mark_failed(self, path_id: int, level_id: int, q_index: int, error: str) -> None:
        existing = self.get(path_id, level_id, q_index)
        existing.status = "failed"
        existing.error = error
        self.set(path_id, level_id, q_index, existing)

    def iter_done_rows(self):
        for key, row in self._state.rows.items():
            if row.get("status") == "done":
                pid, lid, qi = (int(x) for x in key.split(":"))
                yield pid, lid, qi, row
