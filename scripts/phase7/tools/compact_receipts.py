from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List


def compact_receipts(receipts_path: Path, keep_last_n: int = 5) -> Dict[str, Any]:
    payload = json.loads(receipts_path.read_text(encoding="utf-8"))
    receipts: List[Dict[str, Any]] = payload.get("receipts", [])

    by_plan: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in receipts:
        by_plan[str(r.get("plan_id"))].append(r)

    compacted: List[Dict[str, Any]] = []
    removed_count = 0
    per_plan_before = {pid: len(rs) for pid, rs in by_plan.items()}

    for pid, rs in by_plan.items():
        # Preserve original order but keep last N
        kept = rs[-keep_last_n:] if keep_last_n > 0 else []
        removed_count += max(0, len(rs) - len(kept))
        compacted.extend(kept)

    out = {"receipts": compacted}
    receipts_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")

    audit = {
        "receipts_path": str(receipts_path),
        "keep_last_n": int(keep_last_n),
        "total_before": len(receipts),
        "total_after": len(compacted),
        "removed": removed_count,
        "per_plan_before": per_plan_before,
        "per_plan_after": {pid: min(keep_last_n, n) for pid, n in per_plan_before.items()},
    }

    audit_path = receipts_path.parent / "phase7_receipts_compact_audit.json"
    audit_path.write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
    return audit


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Compact Phase-7 receipts file (keep last N per plan_id)")
    p.add_argument("--receipts", required=True, help="Path to phase7_execution_receipts.json")
    p.add_argument("--keep-last", type=int, default=5, help="Keep last N receipts per plan_id (default: 5)")
    return p


def main(argv=None) -> int:
    args = _build_parser().parse_args(argv)
    audit = compact_receipts(Path(args.receipts), keep_last_n=int(args.keep_last))
    print(json.dumps(audit, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
