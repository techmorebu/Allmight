from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

def main() -> int:
    f = Path("outputs/phase4/phase4_control_GRID_BTC_ETH_XRP_XAU_15m_i60.json")
    data = json.loads(f.read_text(encoding="utf-8"))
    assets: Dict[str, Any] = data.get("assets", {})

    print("FILE:", f.as_posix())
    print()

    for a in sorted(assets.keys()):
        node = assets[a]
        score = node.get("score")
        print(f"== {a} ==")
        if isinstance(score, dict):
            print("score keys:", sorted(score.keys()))
        else:
            print("score type:", type(score).__name__)
        print()

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
