from __future__ import annotations

import json
import re
from pathlib import Path
from collections import Counter
from typing import Any, Iterable, Tuple

PATTERNS = [
    re.compile(r"^allow_", re.I),
    re.compile(r"suppress", re.I),
    re.compile(r"confidence", re.I),
    re.compile(r"promotion", re.I),
    re.compile(r"flip", re.I),
]

def walk(obj: Any, path: str="") -> Iterable[Tuple[str, Any]]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{path}.{k}" if path else str(k)
            yield (p, v)
            yield from walk(v, p)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            p = f"{path}[{i}]"
            yield (p, v)
            yield from walk(v, p)

def main() -> int:
    f = Path("outputs/phase4/phase4_control_GRID_BTC_ETH_XRP_XAU_15m_i60.json")
    data = json.loads(f.read_text(encoding="utf-8"))

    hits = []
    key_counts = Counter()

    for p, v in walk(data):
        # capture keys at dict boundaries
        if p and "." in p:
            last = p.rsplit(".", 1)[-1]
            key_counts[last] += 1

        # match on the leaf key name
        leaf = p.rsplit(".", 1)[-1] if "." in p else p
        if any(rx.search(leaf) for rx in PATTERNS):
            hits.append((p, type(v).__name__))

    print("== MATCHED PATHS (first 200) ==")
    for p, t in hits[:200]:
        print(f"{p} :: {t}")
    if len(hits) > 200:
        print(f"... ({len(hits)-200} more)")

    print("\n== MATCHED KEY NAMES (top 60) ==")
    # list only keys whose names match patterns
    matched_keys = [k for k in key_counts if any(rx.search(k) for rx in PATTERNS)]
    for k in sorted(matched_keys)[:60]:
        print(k)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
