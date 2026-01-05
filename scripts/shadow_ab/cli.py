from __future__ import annotations

import argparse
import json
from pathlib import Path

from .io import load_snapshots_jsonl
from .runner import RunConfig, run_shadow_ab

def main() -> int:
    ap = argparse.ArgumentParser(description="AllMight Shadow A/B Harness (skeleton, inert)")
    ap.add_argument("--snapshots", required=True, help="Path to snapshots.jsonl")
    ap.add_argument("--limit", type=int, default=200, help="Limit number of snapshots (default 200)")
    ap.add_argument("--run-id", default=None, help="Optional explicit run id")
    args = ap.parse_args()

    snaps = load_snapshots_jsonl(Path(args.snapshots), limit=args.limit)
    cfg = RunConfig()
    out_dir = run_shadow_ab(snaps, cfg, run_id=args.run_id)

    # Operator-friendly summary (predictable, copy-paste safe)
    manifest_path = out_dir / "inputs_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    anomalies_path = out_dir / "anomalies.log"
    anomalies_count = 0
    if anomalies_path.exists():
        anomalies_count = len([ln for ln in anomalies_path.read_text(encoding="utf-8").splitlines() if ln.strip()])

    rid = manifest.get("run_id")
    n = manifest.get("n_snapshots")
    print(f"shadow_ab: run_id={rid} snapshots={n} anomalies={anomalies_count} out_dir={out_dir}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
