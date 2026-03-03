#!/usr/bin/env python3
"""
scripts/watchdog.py
Monitors AllMight processes and Redis freshness.

Schedule:
  Every 5 min  -- process health + Redis freshness
  Every 30 min -- heartbeat (TERMINAL channel)
  Every 60 min -- hourly report (DETAILED channel)
  Weekly       -- full rollup (Sunday 00:00 UTC)
"""

import os, sys, time, json, subprocess
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from utils.discord_alerts import discord

PID_FILE        = ROOT / "logs/pids.txt"
CHECK_INTERVAL  = 300   # 5 minutes per tick
HEARTBEAT_EVERY = 6     # ticks -> 30 minutes
HOURLY_EVERY    = 12    # ticks -> 60 minutes
WEEKLY_DOW      = 6     # Sunday (0=Mon)
SESSION_START   = 13    # 8am CST = 13 UTC
SESSION_END     = 21    # 4pm CST = 21 UTC
DROUGHT_HOURS   = 6

import redis as _redis
_r = _redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)


def load_pids():
    if not PID_FILE.exists(): return {}
    pids = {}
    for line in PID_FILE.read_text().splitlines():
        if "=" in line:
            k, v = line.strip().split("=", 1)
            try: pids[k.strip()] = int(v.strip())
            except: pass
    return pids


def is_alive(pid):
    try: os.kill(pid, 0); return True
    except: return False


def redis_freshness():
    try:
        keys = _r.keys("fetcher:*")
        if not keys: return False, 0, 999
        ages = []
        for key in keys:
            raw = _r.get(key)
            if not raw: continue
            try:
                blob = json.loads(raw)
                ts   = blob.get("timestamp", "")
                if ts:
                    dt  = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    age = (datetime.now(timezone.utc) - dt).total_seconds()
                    ages.append(age)
            except: continue
        if not ages: return True, len(keys), 0
        min_age = min(ages) / 60
        return min_age < 6, len(keys), min_age
    except: return False, 0, 999


def get_gas_snapshot():
    try:
        raw = _r.get("fetcher:gasPriceOracle")
        if not raw: return None
        blob      = json.loads(raw)
        consensus = blob.get("data", {}).get("consensus", {})
        return {
            "standard": consensus.get("standard", 0),
            "fast":     consensus.get("fast", 0),
            "instant":  consensus.get("instant", 0),
            "network":  blob.get("data", {}).get("networkState", {}).get("label", "UNKNOWN"),
        }
    except: return None


def get_top_opportunities(n=3):
    import csv
    from datetime import timedelta
    csv_path = ROOT / "logs/shadow_trades.csv"
    if not csv_path.exists(): return []
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
        recent = []
        with open(csv_path) as f:
            for row in csv.DictReader(f):
                try:
                    ts = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                    if ts > cutoff:
                        recent.append(row)
                except: continue
        recent.sort(key=lambda r: float(r.get("gross_edge_bps", 0)), reverse=True)
        return recent[:n]
    except: return []


def restart_process(name, log_dir):
    os.chdir(ROOT)
    cmds = {
        "fetcher": ["bash", "-c",
            f"while true; do node {ROOT}/scripts/master-fetcher.js once 2>&1; sleep 60; done"],
        "monitor": ["python3", f"{ROOT}/scripts/spread_monitor.py",
                    "--chain", "all", "--interval", "60", "--no-fetch"],
        "shadow":  ["python3", f"{ROOT}/scripts/execution/shadow_mode.py",
                    "--min-edge", "0", "--size", "1000", "--interval", "60"],
        "metrics": ["python3", f"{ROOT}/utils/metrics_engine.py", "--daemon"],
    }
    if name not in cmds: return None
    log  = open(log_dir / f"{name}.log", "a")
    proc = subprocess.Popen(cmds[name], stdout=log, stderr=log)
    lines = PID_FILE.read_text().splitlines() if PID_FILE.exists() else []
    new   = [l for l in lines if not l.startswith(name + "=")]
    new.append(f"{name}={proc.pid}")
    PID_FILE.write_text("\n".join(new) + "\n")
    return proc.pid


def in_session():
    return SESSION_START <= datetime.now(timezone.utc).hour < SESSION_END


def check_drought(check_count):
    if not in_session(): return
    try:
        import csv
        from datetime import timedelta
        csv_path = ROOT / "logs/shadow_trades.csv"
        if not csv_path.exists(): return
        cutoff   = datetime.now(timezone.utc) - timedelta(hours=DROUGHT_HOURS)
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
    except: pass


def check_weekly_rollup():
    now = datetime.now(timezone.utc)
    if now.weekday() == WEEKLY_DOW and now.hour == 0 and now.minute < 6:
        discord.weekly_rollup()


def main():
    print(f"[watchdog] Started | health={CHECK_INTERVAL}s | "
          f"heartbeat={HEARTBEAT_EVERY * CHECK_INTERVAL // 60}min | "
          f"report={HOURLY_EVERY * CHECK_INTERVAL // 60}min")
    discord.system_alert("Watchdog started", level="INFO")

    check_count = 0
    log_dir     = ROOT / "logs"

    while True:
        time.sleep(CHECK_INTERVAL)
        check_count += 1
        pids   = load_pids()
        issues = []

        for name in ("fetcher", "monitor", "shadow", "metrics"):
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

        fresh, key_count, age_min = redis_freshness()
        if not fresh:
            discord.stale_redis(key_count, age_min)

        check_drought(check_count)
        check_weekly_rollup()

        if check_count % HEARTBEAT_EVERY == 0:
            discord.heartbeat()

        if check_count % HOURLY_EVERY == 0:
            discord.hourly_report(
                gas=get_gas_snapshot(),
                top_opportunities=get_top_opportunities(n=3)
            )

        ts     = datetime.now(timezone.utc).strftime("%H:%M UTC")
        status = "OK" if not issues and fresh else "ISSUES"
        print(f"[watchdog {ts}] {status} -- {key_count} Redis keys (check #{check_count})")


if __name__ == "__main__":
    main()
