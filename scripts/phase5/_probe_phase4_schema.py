from __future__ import annotations

import json
from pathlib import Path
from collections import Counter
from typing import Any, Dict, List, Tuple

LIKELY_FIELDS = [
    "asset","symbol","grid","tf","timeframe","asof","horizon",
    "allow_arbitrage","allow_directional","allow_flashloan",
    "is_suppressed","suppressed","suppression_reasons","reasons",
    "suppressed_by_confidence","suppressed_by_promotion","suppressed_by_flip",
]

def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))

def _extract_records(data: Any) -> Tuple[List[Dict[str, Any]], str]:
    if isinstance(data, list):
        if not data:
            raise ValueError("Top-level JSON list is empty.")
        if not isinstance(data[0], dict):
            raise ValueError("Top-level JSON list does not contain dict records.")
        return data, "top_level_list"

    if isinstance(data, dict):
        candidates = []
        for k, v in data.items():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                candidates.append(k)
        if not candidates:
            raise ValueError("Top-level JSON dict has no obvious list-of-dict records.")
        key = candidates[0]
        return data[key], f"dict[{key}]"

    raise ValueError(f"Unexpected JSON top-level type: {type(data).__name__}")

def main() -> int:
    d = Path("outputs/phase4")
    files = sorted(d.glob("phase4_control_*.json"))
    if not files:
        print("ERROR: No files matching outputs/phase4/phase4_control_*.json")
        return 3

    f = files[0]
    print(f"Using sample file: {f.as_posix()}\n")

    try:
        data = _load_json(f)
    except Exception as e:
        print(f"ERROR: Failed to parse JSON: {e}")
        return 4

    print("Top-level type:", type(data).__name__)
    if isinstance(data, dict):
        print("\nTop-level keys (first 200 sorted):")
        print(sorted(list(data.keys()))[:200])

    try:
        recs, hint = _extract_records(data)
    except Exception as e:
        print(f"ERROR: Could not extract records: {e}")
        return 5

    print("\nRecord container:", hint)
    print("Record count:", len(recs))

    print("\nFirst record keys (sorted):")
    print(sorted(recs[0].keys()))

    c = Counter()
    for r in recs:
        c.update(r.keys())

    print("\nKeys frequency (top 40):")
    for k, n in c.most_common(40):
        print(f"{k}: {n}")

    present = [k for k in LIKELY_FIELDS if k in recs[0]]
    print("\nLikely fields present (from first record):")
    print(present)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
