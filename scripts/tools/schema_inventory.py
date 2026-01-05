from __future__ import annotations
from scripts.tools.repo_files import iter_repo_files

import sys
from pathlib import Path as _Path
# Ensure repo root is importable when running as a script
_REPO_ROOT = _Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import re
from dataclasses import fields, is_dataclass
from pathlib import Path
from collections import Counter, defaultdict

ROOTS = [
    Path("allmight"),
    Path("tests"),
]

# Keys we care about (expand as you learn more)
CANDIDATE_KEYS = [
    "pair", "symbol", "product_id", "market", "instrument",
    "bid", "ask", "last", "price", "best_bid", "best_ask",
    "timestamp", "time", "ts",
    "snapshot", "snap", "market_snapshot", "snapshots", "result", "data",
]

KEY_RE = re.compile(r'["\'](' + "|".join(re.escape(k) for k in CANDIDATE_KEYS) + r')["\']')

def scan_files() -> list[Path]:
    out = []
    for root in ROOTS:
        if not root.exists():
            continue
        for p in root.rglob("*.py"):
            out.append(p)
    return out

def main() -> None:
    # 1) canonical schema fields
    canonical = []
    try:
        from allmight.adapters.market_snapshot import MarketSnapshot  # type: ignore
        if is_dataclass(MarketSnapshot):
            canonical = [(f.name, str(getattr(f, "type", ""))) for f in fields(MarketSnapshot)]
        else:
            canonical = [("UNKNOWN", "MarketSnapshot is not a dataclass")]
    except Exception as e:
        canonical = [("ERROR", f"Could not import MarketSnapshot: {e!r}")]

    # 2) observed keys and where they occur
    key_hits = Counter()
    key_files = defaultdict(set)

    files = scan_files()
    for p in files:
        try:
            txt = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for m in KEY_RE.finditer(txt):
            k = m.group(1)
            key_hits[k] += 1
            key_files[k].add(str(p))

    # 3) write report
    out = []
    out.append("ALLMIGHT SCHEMA INVENTORY (AUTO-GENERATED)")
    out.append("=" * 60)
    out.append("")
    out.append("1) Canonical: MarketSnapshot fields (source of truth)")
    out.append("-" * 60)
    for name, typ in canonical:
        out.append(f"- {name}: {typ}")
    out.append("")
    out.append("2) Observed snapshot-related keys (frequency)")
    out.append("-" * 60)
    for k, n in key_hits.most_common():
        out.append(f"- {k}: {n}")
    out.append("")
    out.append("3) Key -> files (first ~20 files per key)")
    out.append("-" * 60)
    for k in sorted(key_files.keys()):
        files_list = sorted(key_files[k])
        out.append(f"- {k}:")
        for fp in files_list[:20]:
            out.append(f"  - {fp}")
        if len(files_list) > 20:
            out.append(f"  ... +{len(files_list)-20} more")
    out.append("")
    out.append("NOTES")
    out.append("-" * 60)
    out.append("This report shows what the repo *actually* uses today.")
    out.append("Use it to define aliasing + coercion rules without guessing.")
    out.append("")

    Path("docs/phase12").mkdir(parents=True, exist_ok=True)
    Path("docs/phase12/SCHEMA_INVENTORY.txt").write_text("\n".join(out), encoding="utf-8")
    print("Wrote: docs/phase12/SCHEMA_INVENTORY.txt")

if __name__ == "__main__":
    main()
