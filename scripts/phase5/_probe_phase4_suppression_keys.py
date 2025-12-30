from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))

def _extract_records(data: Any) -> List[Dict[str, Any]]:
    if isinstance(data, list):
        if not data or not isinstance(data[0], dict):
            raise ValueError("Top-level list is empty or not list-of-dicts.")
        return data

    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
        raise ValueError("Top-level dict has no list-of-dict records.")

    raise ValueError(f"Unexpected top-level type: {type(data).__name__}")

def main() -> int:
    d = Path("outputs/phase4")
    files = sorted(d.glob("phase4_control_*.json"))
    if not files:
        print("ERROR: No files matching outputs/phase4/phase4_control_*.json")
        return 3

    f = files[0]
    print(f"Using sample file: {f.as_posix()}\n")

    data = _load_json(f)
    recs = _extract_records(data)

    keys = set()
    for r in recs:
        keys.update(r.keys())

    supp = sorted([k for k in keys if re.search(r"suppress", k, re.I)])

    print("Suppression-like keys:")
    for k in supp:
        print(" -", k)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
