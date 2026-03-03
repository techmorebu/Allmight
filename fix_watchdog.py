#!/usr/bin/env python3
"""
fix_watchdog.py
Fixes two bugs in scripts/watchdog.py:
  1. HOURLY_EVERY constant missing (NameError)
  2. check_drought imports _load_trades/_stats from discord_alerts (ImportError)

Run from ~/Allmight:  python3 fix_watchdog.py
"""
import sys
from pathlib import Path

TARGET = Path("scripts/watchdog.py")
BACKUP = Path("logs/backups/watchdog.py.pre_fix2.bak")

if not TARGET.exists():
    print(f"ERROR: {TARGET} not found. Run from ~/Allmight."); sys.exit(1)

src = TARGET.read_text()
original = src

# ── Fix 1: Add HOURLY_EVERY constant after HEARTBEAT_EVERY ───────────────────
if "HOURLY_EVERY" not in src:
    src = src.replace(
        "HEARTBEAT_EVERY = 6     # ticks -> 30 minutes",
        "HEARTBEAT_EVERY = 6     # ticks -> 30 minutes\nHOURLY_EVERY    = 12    # ticks -> 60 minutes"
    )
    print("  Fix 1 applied: added HOURLY_EVERY = 12")
else:
    print("  Fix 1 skipped: HOURLY_EVERY already present")

# ── Fix 2: Replace check_drought with self-contained version ─────────────────
old_drought = '''def check_drought(check_count):
    if not in_session(): return
    try:
        from utils.discord_alerts import _load_trades, _stats
        hr_trades = _load_trades(hours=DROUGHT_HOURS)
        s = _stats(hr_trades)
        if s["executed"] == 0 and check_count > 1:
            discord.signal_drought(DROUGHT_HOURS)
    except: pass'''

new_drought = '''def check_drought(check_count):
    """Alert if no trades executed during session hours in DROUGHT_HOURS window."""
    if not in_session(): return
    try:
        import csv
        from datetime import timedelta
        csv_path = ROOT / "logs/shadow_trades.csv"
        if not csv_path.exists(): return
        cutoff = datetime.now(timezone.utc) - timedelta(hours=DROUGHT_HOURS)
        executed = 0
        with open(csv_path) as f:
            for row in csv.DictReader(f):
                try:
                    ts = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                    if ts > cutoff and row.get("decision","").upper() == "EXECUTE":
                        executed += 1
                except: continue
        if executed == 0 and check_count > 1:
            discord.signal_drought(DROUGHT_HOURS)
    except: pass'''

if "_load_trades" in src:
    src = src.replace(old_drought, new_drought)
    if "_load_trades" not in src:
        print("  Fix 2 applied: check_drought now self-contained")
    else:
        # Pattern didn't match exactly -- do a targeted line replacement
        lines = src.splitlines()
        new_lines = []
        skip = False
        for i, line in enumerate(lines):
            if "from utils.discord_alerts import _load_trades" in line:
                # Replace the three bad lines with safe csv-based version
                new_lines.append("        csv_path = ROOT / 'logs/shadow_trades.csv'")
                new_lines.append("        if not csv_path.exists(): return")
                new_lines.append("        import csv")
                new_lines.append("        from datetime import timedelta")
                new_lines.append("        cutoff = datetime.now(timezone.utc) - timedelta(hours=DROUGHT_HOURS)")
                new_lines.append("        executed = 0")
                new_lines.append("        with open(csv_path) as f:")
                new_lines.append("            for row in csv.DictReader(f):")
                new_lines.append("                try:")
                new_lines.append("                    ts = datetime.fromisoformat(row['timestamp'].replace('Z','+00:00'))")
                new_lines.append("                    if ts > cutoff and row.get('decision','').upper() == 'EXECUTE':")
                new_lines.append("                        executed += 1")
                new_lines.append("                except: continue")
                skip = 2  # skip next 2 lines (_load_trades result lines)
            elif skip:
                skip -= 1
            else:
                # Fix the executed check line
                if "s[\"executed\"]" in line or "s['executed']" in line:
                    new_lines.append(line.replace('s["executed"]', 'executed').replace("s['executed']", 'executed'))
                else:
                    new_lines.append(line)
        src = "\n".join(new_lines)
        print("  Fix 2 applied: check_drought patched via line replacement")
else:
    print("  Fix 2 skipped: _load_trades not found (already fixed)")

# ── Write output ──────────────────────────────────────────────────────────────
if src == original:
    print("\n  No changes needed -- watchdog already correct.")
    sys.exit(0)

BACKUP.parent.mkdir(exist_ok=True)
BACKUP.write_text(original)
TARGET.write_text(src)

print(f"\n  Backup: {BACKUP}")
print(f"  Patched: {TARGET}")

# ── Verify ────────────────────────────────────────────────────────────────────
result = TARGET.read_text()
ok = True
if "HOURLY_EVERY" not in result:
    print("  ERROR: HOURLY_EVERY still missing"); ok = False
if "_load_trades" in result:
    print("  ERROR: _load_trades still present"); ok = False
if ok:
    print("  Verification: PASSED")
    print("\n  Restart watchdog:")
    print("    kill $(grep watchdog logs/pids.txt | cut -d= -f2) 2>/dev/null || true")
    print("    python3 scripts/watchdog.py >> logs/watchdog.log 2>&1 &")
    print("    echo watchdog=$! >> logs/pids.txt")
