from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple


class ReplayComponentError(RuntimeError):
    pass


@dataclass(frozen=True)
class ComponentRow:
    asset: str
    value: float
    audit: dict


def read_component_csv_as_map(
    path: Path,
    grid_assets: List[str],
    *,
    value_col: str = "value",
    asset_col: str = "asset",
    component_name: str = "component",
    allow_missing: bool = False,
) -> Tuple[Dict[str, float], dict]:
    """
    Reads a CSV with at least asset,value columns and returns (asset->value map, audit).
    Deterministic: never reorders grid_assets.
    Policy:
      - missing file => error unless allow_missing (then default zeros)
      - missing assets => error unless allow_missing (then default zeros)
    """
    if not path.exists():
        if allow_missing:
            m = {a: 0.0 for a in grid_assets}
            return m, {"component": component_name, "path": str(path), "policy": "default_zero_missing_file"}
        raise ReplayComponentError(
            f"Missing {component_name} CSV: {path}. Generate it first or pass --allow-missing."
        )

    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        if asset_col not in fields or value_col not in fields:
            raise ReplayComponentError(
                f"Bad {component_name} CSV schema: {path}. Expected {asset_col},{value_col}. Got {fields}"
            )
        out: Dict[str, float] = {}
        for row in reader:
            a = (row.get(asset_col) or "").strip()
            if a in grid_assets:
                raw = row.get(value_col)
                try:
                    out[a] = float(raw) if raw not in (None, "") else 0.0
                except Exception as e:
                    raise ReplayComponentError(
                        f"Non-numeric {component_name} value for asset={a} in {path}: {raw}"
                    ) from e

    missing = [a for a in grid_assets if a not in out]
    audit = {"component": component_name, "path": str(path), "missing_assets": missing}
    if missing and not allow_missing:
        raise ReplayComponentError(
            f"{component_name} CSV missing {len(missing)} grid assets (first 8): {missing[:8]}. "
            f"Fix generator or pass --allow-missing."
        )

    if allow_missing and missing:
        for a in missing:
            out[a] = 0.0
        audit["policy"] = "default_zero_missing_rows"

    return out, audit


def write_component_csv(path: Path, rows: List[ComponentRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["asset", "value", "audit_json"])
        w.writeheader()
        for r in rows:
            w.writerow(
                {
                    "asset": r.asset,
                    "value": f"{float(r.value):.6f}",
                    "audit_json": json.dumps(r.audit, sort_keys=True),
                }
            )
