#!/usr/bin/env python3
"""
scripts/watchdog.py
Monitors AllMight processes and Redis freshness.
Wired to full notification system in utils/discord_alerts.py.
"""

import os, sys, time, json, signal, subprocess
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from utils.discord_alerts import discord

PID_FILE        = ROOT / "logs/pids.txt"
CHECK_INTERVAL  = 300   # 5 minutes
HEARTBEAT_EVERY = 12    # checks (= 1 hour)
WEEKLY_DOW      = 6     # Sunday (0=Mon)
REDIS_STALE_SEC = 360   # 6 minutes
SESSION_START   = 13    # 8am CST = 13 UTC
SESSION_END     = 21    # 4pm CST = 21 UTC
DROUGHT_HOURS   = 6     # alert if no trades in 6hr during session

import redis as _redis
_r = _redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)


def load_pids():
    if not PID_FILE.exists(): return {}
    pids = {}
    for line in PID_FILE.read_text().splitlines():
        if "=" in line:
            k,v = line.strip().split("=",1)
            try: pids[k.strip()] = int(v.strip())
            except: pass
    return pids


def is_alive(pid):
    try: os.kill(pid, 0); return True
    except: return False


def redis_freshness():
    """Returns (is_fresh, key_count, age_minutes)."""
    try:
        keys = _r.keys("fetcher:*")
        if not keys: return False, 0, 999
        ages = []
        for key in keys:
            raw = _r.get(key)
            if not raw: continue
            try:
                blob = json.loads(raw)
                ts   = blob.get("timestamp","")
                if ts:
                    dt  = datetime.fromisoformat(ts.replace("Z","+00:00"))
                    age = (datetime.now(timezone.utc)-dt).total_seconds()
                    ages.append(age)
            except: continue
        if not ages: return True, len(keys), 0
        min_age = min(ages) / 60
        return min_age < 6, len(keys), min_age
    except: return False, 0, 999


def restart_process(name, log_dir):
    os.chdir(ROOT)
    cmds = {
        "fetcher": ["bash","-c",
            f"while true; do node {ROOT}/scripts/master-fetcher.js once 2>&1;"
            f" sleep 60; done"],
        "monitor": ["python3", f"{ROOT}/scripts/spread_monitor.py",
                    "--chain","all","--interval","60"],
        "shadow":  ["python3", f"{ROOT}/scripts/execution/shadow_mode.py",
                    "--min-edge","0","--size","1000","--interval","60"],
    }
    if name not in cmds: return None
    log = open(log_dir / f"{name}.log", "a")
    proc = subprocess.Popen(cmds[name], stdout=log, stderr=log)
    lines = PID_FILE.read_text().splitlines() if PID_FILE.exists() else []
    new   = [l for l in lines if not l.startswith(name+"=")]
    new.append(f"{name}={proc.pid}")
    PID_FILE.write_text("\n".join(new)+"\n")
    return proc.pid


def in_session():
    h = datetime.now(timezone.utc).hour
    return SESSION_START <= h < SESSION_END


def check_drought(check_count):
    """Alert if no trades during session hours."""
    if not in_session(): return
    from utils.discord_alerts import _load_trades, _stats
    hr_trades = _load_trades(hours=DROUGHT_HOURS)
    s = _stats(hr_trades)
    if s["executed"] == 0 and check_count > 1:
        discord.signal_drought(DROUGHT_HOURS)


def check_weekly_rollup():
    """Fire weekly rollup on Sunday."""
    now = datetime.now(timezone.utc)
    if now.weekday() == WEEKLY_DOW and now.hour == 0 and now.minute < 6:
        discord.weekly_rollup()


def main():
    print(f"[watchdog] Started -- check every {CHECK_INTERVAL}s")
    discord.system_alert("Watchdog started", level="INFO")

    check_count = 0
    log_dir     = ROOT / "logs"

    while True:
        time.sleep(CHECK_INTERVAL)
        check_count += 1
        pids   = load_pids()
        issues = []

        # Process health
        for name in ("fetcher","monitor","shadow"):
            pid = pids.get(name)
            if pid is None:
                issues.append(f"{name}: no PID")
                continue
            if not is_alive(pid):
                discord.process_dead(name, pid)
                new_pid = restart_process(name, log_dir)
                if new_pid:
                    discord.process_restarted(name, pid, new_pid)
                else:
                    discord.error(f"Failed to restart {name}", component="watchdog")

        # Redis freshness
        fresh, key_count, age_min = redis_freshness()
        if not fresh:
            discord.stale_redis(key_count, age_min)

        # Signal drought during session hours
        check_drought(check_count)

        # Weekly rollup
        check_weekly_rollup()

        # Hourly heartbeat
        if check_count % HEARTBEAT_EVERY == 0:
            discord.heartbeat()

        ts = datetime.now(timezone.utc).strftime("%H:%M UTC")
        status = "OK" if not issues and fresh else "ISSUES"
        print(f"[watchdog {ts}] {status} -- {key_count} Redis keys")


if __name__ == "__main__":
    main()
