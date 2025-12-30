from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

def main() -> int:
    f = Path("outputs/phase4/phase4_control_GRID_BTC_ETH_XRP_XAU_15m_i60.json")
    if not f.exists():
        print(f"ERROR: missing file: {f}")
        return 2

    data = json.loads(f.read_text(encoding="utf-8"))
    assets: Dict[str, Any] = data.get("assets", {})
    if not isinstance(assets, dict) or not assets:
        print("ERROR: assets missing or not a dict")
        return 3

    print("FILE:", f.as_posix())
    print("TOP asof:", data.get("asof"))
    print("TOP grid:", data.get("grid"))
    print()

    for a in sorted(assets.keys()):
        node = assets[a]
        print(f"== {a} ==")

        perms = node.get("permissions")
        print("permissions:", perms)

        overrides = node.get("overrides_applied")
        if overrides is None:
            print("overrides_applied: <missing>")
        elif not isinstance(overrides, list):
            print("overrides_applied type:", type(overrides).__name__, "preview:", repr(overrides)[:200])
        else:
            print(f"overrides_applied count: {len(overrides)}")
            for i, ov in enumerate(overrides[:10]):
                if isinstance(ov, dict):
                    print(f"  - override[{i}] keys:", sorted(ov.keys()))
                    # print a small stable subset if present
                    for k in ["rule", "reason", "code", "message", "band_flip", "confidence_threshold_used"]:
                        if k in ov:
                            print(f"      {k}: {ov[k]}")
                else:
                    print(f"  - override[{i}] type:", type(ov).__name__, "preview:", repr(ov)[:200])
        print()

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
