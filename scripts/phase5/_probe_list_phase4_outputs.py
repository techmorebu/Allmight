from __future__ import annotations
from pathlib import Path

def main() -> int:
    d = Path("outputs/phase4")
    if not d.exists():
        print("ERROR: outputs/phase4 does not exist.")
        return 2

    print("== outputs/phase4 directory listing ==")
    for p in sorted(d.iterdir()):
        kind = "DIR " if p.is_dir() else "FILE"
        print(f"{kind}  {p}")

    print("\n== phase4_control_*.json candidates ==")
    files = sorted(d.glob("phase4_control_*.json"))
    if not files:
        print("ERROR: No files matching outputs/phase4/phase4_control_*.json")
        return 3

    for p in files[:50]:
        print(p.as_posix())
    if len(files) > 50:
        print(f"... ({len(files)-50} more)")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
