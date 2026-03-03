#!/usr/bin/env python3
"""
fix_watchdog2.py
Directly fixes scripts/watchdog.py with surgical sed-style replacements.
Run from ~/Allmight:  python3 fix_watchdog2.py
"""
import sys
from pathlib import Path

TARGET = Path("scripts/watchdog.py")
if not TARGET.exists():
    print(f"ERROR: {TARGET} not found. Run from ~/Allmight."); sys.exit(1)

src = TARGET.read_text()
Path("logs/backups").mkdir(exist_ok=True)
Path("logs/backups/watchdog.pre_fix2.bak").write_text(src)
print("Backup saved.")

# ── Fix 1: Add HOURLY_EVERY after HEARTBEAT_EVERY ────────────────────────────
if "HOURLY_EVERY" not in src:
    src = src.replace(
        "HEARTBEAT_EVERY = 6     # ticks -> 30 minutes",
        "HEARTBEAT_EVERY = 6     # ticks -> 30 minutes\nHOURLY_EVERY    = 12    # ticks -> 60 minutes"
    )
    if "HOURLY_EVERY" in src:
        print("Fix 1 OK: HOURLY_EVERY added")
    else:
        # fallback -- try alternate spacing
        src = src.replace(
            "HEARTBEAT_EVERY = 6",
            "HEARTBEAT_EVERY = 6\nHOURLY_EVERY    = 12    # ticks -> 60 minutes"
        )
        print("Fix 1 OK: HOURLY_EVERY added (fallback)")
else:
    print("Fix 1 skipped: already present")

# ── Fix 2: Replace check_drought with self-contained version ─────────────────
if "_load_trades" in src or "_stats" in src:
    old = '''def check_drought(check_count):
    """Alert if no trades during session hours."""
    if not in_session(): return
    from utils.discord_alerts import _load_trades, _stats
    hr_trades = _load_trades(hours=DROUGHT_HOURS)
    s = _stats(hr_trades)
    if s["executed"] == 0 and check_count > 1:
        discord.signal_drought(DROUGHT_HOURS)'''

    new = '''def check_drought(check_count):
    """Alert if no trades executed during session hours in DROUGHT_HOURS window."""
    if not in_session(): return
    try:
        import csv
        from datetime import timedelta
        csv_path = ROOT / "logs/shadow_trades.csv"
        if not csv_path.exists(): return
        cutoff  = datetime.now(timezone.utc) - timedelta(hours=DROUGHT_HOURS)
        executed = 0
        with open(csv_path) as f:
            for row in csv.DictReader(f):
                try:
                    ts = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                    if ts > cutoff and row.get("decision", "").upper() == "EXECUTE":
                        executed += 1
                except: continue
        if executed == 0 and check_count > 1:
            discord.signal_drought(DROUGHT_HOURS)
    except: pass'''

    src = src.replace(old, new)
    if "_load_trades" not in src:
        print("Fix 2 OK: check_drought replaced")
    else:
        print("Fix 2 FAILED: pattern mismatch -- manual fix needed")
        print("  Run: grep -n '_load_trades' scripts/watchdog.py")
        sys.exit(1)
else:
    print("Fix 2 skipped: already fixed")

# ── Write and verify ──────────────────────────────────────────────────────────
TARGET.write_text(src)

errors = []
if "HOURLY_EVERY" not in src:   errors.append("HOURLY_EVERY missing")
if "_load_trades" in src:       errors.append("_load_trades still present")
if "IndentationError" in src:   errors.append("IndentationError text in file")

if errors:
    print(f"\nERRORS: {errors}")
    sys.exit(1)

print("\nVerification: PASSED")
print("\nRestart watchdog:")
print("  kill $(grep watchdog logs/pids.txt | cut -d= -f2) 2>/dev/null || true")
print("  sed -i '/^watchdog=/d' logs/pids.txt")
print("  python3 scripts/watchdog.py >> logs/watchdog.log 2>&1 &")
print("  echo watchdog=$! >> logs/pids.txt")
print("  sleep 3 && tail -5 logs/watchdog.log")
