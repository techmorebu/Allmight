#!/usr/bin/env python3
"""
scripts/cap_csv_logs.py
Caps shadow_trades.csv and spread_monitor.csv at 10k rows.
Archives overflow to logs/archive/
"""
import csv, shutil
from pathlib import Path
from datetime import datetime, timezone

ROOT     = Path(__file__).resolve().parent.parent
LOG_DIR  = ROOT / "logs"
ARCH_DIR = LOG_DIR / "archive"
MAX_ROWS = 10_000

ARCH_DIR.mkdir(exist_ok=True)

for csv_file in [LOG_DIR/"shadow_trades.csv", LOG_DIR/"spread_monitor.csv"]:
    if not csv_file.exists(): continue
    with open(csv_file) as f:
        rows = list(csv.reader(f))
    if len(rows) <= MAX_ROWS + 1:
        print(f"{csv_file.name}: {len(rows)-1} rows -- OK")
        continue
    header   = rows[0]
    data     = rows[1:]
    overflow = data[:-MAX_ROWS]
    keep     = data[-MAX_ROWS:]
    ts       = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    arch     = ARCH_DIR / f"{csv_file.stem}_{ts}.csv"
    with open(arch, "w", newline="") as f:
        w = csv.writer(f); w.writerow(header); w.writerows(overflow)
    with open(csv_file, "w", newline="") as f:
        w = csv.writer(f); w.writerow(header); w.writerows(keep)
    print(f"{csv_file.name}: archived {len(overflow)} rows, kept {len(keep)}")
