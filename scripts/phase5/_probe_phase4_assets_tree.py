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

    print("Top-level keys:", sorted(data.keys()))
    print("asof:", data.get("asof"))
    print("grid:", data.get("grid"))
    print("phase:", data.get("phase"))
    print()

    assets = data.get("assets")
    if assets is None:
        print("ERROR: no 'assets' key in Phase-4 output.")
        return 3

    print("assets type:", type(assets).__name__)
    if isinstance(assets, dict):
        asset_names = sorted(list(assets.keys()))
        print("asset keys:", asset_names)
        print()

        # For each asset, print its top-level keys and a shallow preview of key->type
        for a in asset_names:
            node = assets[a]
            print(f"== ASSET {a} ==")
            print("type:", type(node).__name__)
            if isinstance(node, dict):
                k = sorted(node.keys())
                print("keys:", k)
                print("key->type:")
                for kk in k[:50]:
                    vv = node.get(kk)
                    print(f"  {kk}: {type(vv).__name__}")
            else:
                print("value preview:", repr(node)[:200])
            print()
        return 0

    # If it's not a dict, print preview
    print("assets preview:", repr(assets)[:500])
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
