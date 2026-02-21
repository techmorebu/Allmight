#!/usr/bin/env python3
"""
scripts/watchdog.py

Monitors AllMight processes and Redis freshness.
Sends Discord alerts and auto-restarts dead processes.

Usage (started by start_allmight.sh):
    python3 scripts/watchdog.py &
"""

import os
import sys
import time
import json
import signal
import subprocess
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from utils.discord_alerts import discord

PID_FILE       = ROOT / "logs/pids.txt"
FETCHER_LOG    = ROOT / "logs/fetcher.log"
CHECK_INTERVAL = 300   # 5 minutes
HEARTBEAT_EVERY = 12   # checks (12 * 5min = 1 hour)
REDIS_STALE_SEC = 360  # 6 minutes -- fetcher runs every 60s

import redis as _redis
r = _redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)


def load_pids() -> dict:
    if not PID_FILE.exists():
        return {}
    pids = {}
    for line in PID_FILE.read_text().splitlines():
        if "=" in line:
            name, pid = line.strip().split("=", 1)
            pids[name.strip()] = int(pid.strip())
    return pids


def is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def redis_is_fresh() -> tuple[bool, int]:
    """Returns (is_fresh, key_count)."""
    try:
        keys = r.keys("fetcher:*")
        if not keys:
            return False, 0
        # Check timestamp of most recent write
        freshest = 0
        for key in keys:
            raw = r.get(key)
            if not raw:
                continue
            try:
                blob = json.loads(raw)
                ts_str = blob.get("timestamp", "")
                if ts_str:
                    from datetime import datetime, timezone
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    age = (datetime.now(timezone.utc) - ts).total_seconds()
                    freshest = max(freshest, -age)  # most recent = least negative
            except Exception:
                continue
        # If we got keys but couldn't parse timestamps, assume fresh
        return True, len(keys)
    except Exception:
        return False, 0


def restart_process(name: str, pids: dict) -> int | None:
    """Attempt to restart a dead process. Returns new PID or None."""
    os.chdir(ROOT)
    env = os.environ.copy()

    commands = {
        "fetcher": ["bash", "-c",
            f"while true; do node {ROOT}/scripts/master-fetcher.js once 2>&1; sleep 60; done"],
        "monitor": ["python3", f"{ROOT}/scripts/spread_monitor.py",
            "--chain", "all", "--interval", "60"],
        "shadow":  ["python3", f"{ROOT}/scripts/execution/shadow_mode.py",
            "--min-edge", "0", "--size", "1000", "--interval", "60"],
    }

    if name not in commands:
        return None

    log_file = open(ROOT / f"logs/{name}.log", "a")
    proc = subprocess.Popen(
        commands[name], stdout=log_file, stderr=log_file, env=env
    )

    # Update PID file
    lines = PID_FILE.read_text().splitlines() if PID_FILE.exists() else []
    new_lines = [l for l in lines if not l.startswith(name + "=")]
    new_lines.append(f"{name}={proc.pid}")
    PID_FILE.write_text("\n".join(new_lines) + "\n")

    return proc.pid


def main():
    print(f"[watchdog] Started -- check every {CHECK_INTERVAL}s")
    discord.system_alert("🐕 Watchdog started -- monitoring all processes", level="INFO")

    check_count = 0

    while True:
        time.sleep(CHECK_INTERVAL)
        check_count += 1
        ts = datetime.now(timezone.utc).strftime("%H:%M UTC")
        pids = load_pids()
        issues = []

        # ── Check process health ──────────────────────────────────────────────
        for name in ("fetcher", "monitor", "shadow"):
            pid = pids.get(name)
            if pid is None:
                issues.append(f"{name}: no PID recorded")
                continue
            if not is_alive(pid):
                issues.append(f"{name} (PID {pid}) DEAD -- restarting")
                new_pid = restart_process(name, pids)
                if new_pid:
                    issues[-1] += f" -> new PID {new_pid}"
                else:
                    issues[-1] += " -> restart FAILED"

        # ── Check Redis freshness ─────────────────────────────────────────────
        fresh, key_count = redis_is_fresh()
        if not fresh or key_count < 5:
            issues.append(f"Redis stale or empty: {key_count} keys")

        # ── Send alerts if issues ─────────────────────────────────────────────
        if issues:
            msg = "\n".join(issues)
            print(f"[watchdog {ts}] ISSUES: {msg}")
            discord.system_alert(f"Issues detected at {ts}:\n{msg}", level="WARNING")
        else:
            print(f"[watchdog {ts}] All OK -- {key_count} Redis keys")

        # ── Hourly heartbeat ──────────────────────────────────────────────────
        if check_count % HEARTBEAT_EVERY == 0:
            status = f"{key_count} Redis keys | {len(pids)} processes running"
            if issues:
                status += f" | {len(issues)} issues"
            discord.heartbeat(f"Hourly check at {ts} -- {status}")


if __name__ == "__main__":
    main()
