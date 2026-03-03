#!/usr/bin/env python3
"""
scripts/execution/shadow_mode_v2.py

AllMight arbitrage engine v2 -- on-chain quote detection with full
Discord notifications wired to the existing discord_alerts.py v7.

NOTIFICATION CHANNELS:
  TERMINAL  -- startup, shutdown, heartbeat (every 30min)
  ALERT     -- every executed opportunity (shadow or live)
  DETAILED  -- hourly summary report
  ERRORS    -- quoter down, Redis stale, live reverts

Usage:
    python3 scripts/execution/shadow_mode_v2.py           # shadow
    python3 scripts/execution/shadow_mode_v2.py --live    # live execution
    python3 scripts/execution/shadow_mode_v2.py --report  # print report
    python3 scripts/execution/shadow_mode_v2.py --once    # single scan
"""

import argparse
import csv
import json
import os
import time
import sys
from datetime import datetime, timezone
from pathlib import Path

import redis

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT))

from utils.discord_alerts import discord as _discord
from utils.live_executor   import LiveExecutor

# ── Config ─────────────────────────────────────────────────────────────────────
REDIS_HOST      = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT      = int(os.getenv("REDIS_PORT", 6379))
REDIS_KEY       = "quoter:opportunities"
POLL_INTERVAL   = 5           # seconds between Redis polls
MAX_OPP_AGE_SEC = 60          # ignore quotes older than 60s
MIN_NET_USD     = float(os.getenv("MIN_NET_USD", "0.05"))

LOG_DIR   = REPO_ROOT / "logs"
TRADE_LOG = LOG_DIR / "shadow_trades_v2.csv"

TRADE_LOG_HEADERS = [
    "timestamp", "chain", "pair",
    "buy_venue", "sell_venue",
    "trade_size_usd", "final_usd",
    "gross_usd", "aave_fee_usd", "gas_usd", "net_usd",
    "gross_bps", "net_bps",
    "decision", "mode", "result", "tx_hash", "note",
]

# Notification intervals
HEARTBEAT_INTERVAL  = 1800   # 30 min
HOURLY_INTERVAL     = 3600   # 1 hr
DROUGHT_THRESHOLD   = 3600   # 1 hr no executions = drought alert


# ── Redis ──────────────────────────────────────────────────────────────────────
def load_opportunities(r: redis.Redis) -> tuple[list[dict], bool]:
    """
    Returns (opportunities, quoter_is_live).
    quoter_is_live=False means the quoter hasn't written data yet or it's stale.
    """
    raw = r.get(REDIS_KEY)
    if not raw:
        return [], False

    try:
        data = json.loads(raw)
    except Exception:
        return [], False

    ts_str = data.get("timestamp", "")
    if ts_str:
        try:
            ts  = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            age = (datetime.now(timezone.utc) - ts).total_seconds()
            if age > MAX_OPP_AGE_SEC:
                return [], False   # stale -- quoter may be down
        except Exception:
            pass

    opps = data.get("opportunities", [])
    return [o for o in opps if isinstance(o, dict) and o.get("profitable", False)], True


# ── CSV logger ─────────────────────────────────────────────────────────────────
def _ensure_log():
    LOG_DIR.mkdir(exist_ok=True)
    if not TRADE_LOG.exists():
        with open(TRADE_LOG, "w", newline="") as f:
            csv.writer(f).writerow(TRADE_LOG_HEADERS)


def log_trade(opp: dict, mode: str, decision: str,
              result: str = "", tx_hash: str = "", note: str = ""):
    ts = datetime.now(timezone.utc).isoformat()
    row = [
        ts,
        opp.get("chain", ""),
        opp.get("pair", ""),
        opp.get("buyVenue", ""),
        opp.get("sellVenue", ""),
        opp.get("tradeSizeUsd", ""),
        opp.get("finalUsd", ""),
        opp.get("grossUsd", ""),
        opp.get("aaveFeeUsd", ""),
        opp.get("gasCostUsd", ""),
        opp.get("netUsd", ""),
        opp.get("grossBps", ""),
        opp.get("netBps", ""),
        decision, mode, result, tx_hash, note,
    ]
    with open(TRADE_LOG, "a", newline="") as f:
        csv.writer(f).writerow(row)


# ── Report ─────────────────────────────────────────────────────────────────────
def print_report():
    if not TRADE_LOG.exists():
        print("No shadow v2 trades logged yet.")
        return
    trades = []
    with open(TRADE_LOG) as f:
        reader = csv.DictReader(f)
        for row in reader:
            trades.append(row)
    if not trades:
        print("No trades in log.")
        return

    executed  = [t for t in trades if t.get("decision") == "EXECUTE"]
    live_ok   = [t for t in executed if t.get("result") == "success"]
    reverts   = [t for t in executed if t.get("result") == "revert"]
    total_pnl = sum(float(t.get("net_usd", 0)) for t in live_ok)

    print()
    print("=" * 56)
    print("  AllMight v2 Report")
    print("=" * 56)
    print(f"  Total log rows:    {len(trades)}")
    print(f"  Executed:          {len(executed)}")
    print(f"  Live success:      {len(live_ok)}")
    print(f"  Live reverts:      {len(reverts)}")
    print(f"  Confirmed P&L:    ${total_pnl:.4f}")

    by_route: dict = {}
    for t in executed:
        k = f"{t.get('pair','?')} {t.get('buy_venue','')[:10]}->{t.get('sell_venue','')[:10]}"
        if k not in by_route:
            by_route[k] = {"count": 0, "pnl": 0.0, "ok": 0, "rev": 0}
        by_route[k]["count"] += 1
        by_route[k]["pnl"]   += float(t.get("net_usd", 0))
        if t.get("result") == "success": by_route[k]["ok"]  += 1
        if t.get("result") == "revert":  by_route[k]["rev"] += 1

    if by_route:
        print()
        print("  By route:")
        for route, s in sorted(by_route.items(), key=lambda x: -x[1]["pnl"]):
            print(f"    {route}: {s['count']} trades | P&L=${s['pnl']:.4f} | ok={s['ok']} rev={s['rev']}")
    print("=" * 56)


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live",    action="store_true")
    parser.add_argument("--report",  action="store_true")
    parser.add_argument("--once",    action="store_true")
    parser.add_argument("--min-net", type=float, default=MIN_NET_USD)
    args = parser.parse_args()

    if args.report:
        print_report()
        return

    min_net  = args.min_net
    mode     = "LIVE" if args.live else "SHADOW"
    executor = LiveExecutor() if args.live else None

    if args.live:
        os.environ["LIVE_TRADING_ENABLED"] = "true"

    _ensure_log()

    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0, decode_responses=True)

    # ── Startup notification ───────────────────────────────────────────────────
    print(f"[shadow_v2] Starting | mode={mode} | min_net=${min_net}")
    try:
        _discord.startup({"shadow_v2": os.getpid()})
    except Exception as e:
        print(f"[shadow_v2] Discord startup notify failed: {e}")

    # ── Timing trackers ────────────────────────────────────────────────────────
    t_start         = time.time()
    t_last_heartbeat = time.time()
    t_last_hourly   = time.time()
    t_last_exec     = time.time()
    t_last_stale_warn = 0.0

    scan_count  = 0
    exec_count  = 0
    quoter_was_live = True   # track state to detect drop

    try:
        while True:
            scan_count += 1
            now = time.time()
            ts  = datetime.now(timezone.utc).isoformat()[:19]

            # ── Load opportunities ─────────────────────────────────────────────
            try:
                opps, quoter_live = load_opportunities(r)
            except Exception as e:
                print(f"[{ts}] Redis error: {e}")
                _discord.error(str(e), component="shadow_v2 redis")
                time.sleep(POLL_INTERVAL)
                if args.once: break
                continue

            # ── Quoter health check ────────────────────────────────────────────
            if not quoter_live and quoter_was_live:
                msg = f"quoter:opportunities is stale or missing -- onchain_quoter.js down?"
                print(f"[{ts}] ⚠️  {msg}")
                _discord.stale_redis(0, (now - t_last_exec) / 60)
                t_last_stale_warn = now
            quoter_was_live = quoter_live

            # ── Periodic heartbeat (every 30min) ───────────────────────────────
            if now - t_last_heartbeat >= HEARTBEAT_INTERVAL:
                try:
                    _discord.heartbeat()
                except Exception:
                    pass
                t_last_heartbeat = now

            # ── Hourly report ──────────────────────────────────────────────────
            if now - t_last_hourly >= HOURLY_INTERVAL:
                try:
                    _discord.shadow_report()
                except Exception:
                    pass
                t_last_hourly = now

            # ── Drought alert ──────────────────────────────────────────────────
            if exec_count == 0 and now - t_start > DROUGHT_THRESHOLD:
                if now - t_last_stale_warn > DROUGHT_THRESHOLD:
                    hrs = (now - t_start) / 3600
                    try:
                        _discord.signal_drought(hrs)
                    except Exception:
                        pass
                    t_last_stale_warn = now

            # ── No opportunities ───────────────────────────────────────────────
            if not opps:
                if scan_count % 60 == 0:  # log every ~5min
                    print(f"[{ts}] scan #{scan_count} | no profitable routes")
                time.sleep(POLL_INTERVAL)
                if args.once: break
                continue

            # ── Process best opportunity ───────────────────────────────────────
            opp       = opps[0]  # already sorted by netUsd descending
            net_usd   = opp.get("netUsd", 0)
            gross_bps = opp.get("grossBps", 0)
            pair      = opp.get("pair", "?")
            chain     = opp.get("chain", "?")
            buy       = opp.get("buyVenue", "?")
            sell      = opp.get("sellVenue", "?")
            size      = opp.get("tradeSizeUsd", 100)

            if net_usd < min_net:
                time.sleep(POLL_INTERVAL)
                if args.once: break
                continue

            exec_count += 1
            t_last_exec = now
            print(f"[{ts}] ✅ EXECUTE | {chain} {pair} {buy}->{sell} | "
                  f"${size} | gross={gross_bps:+.2f}bps | net=${net_usd:+.4f}")

            # ── Discord ALERT ──────────────────────────────────────────────────
            try:
                _discord.execute_alert(
                    chain     = chain,
                    pair      = pair,
                    gross_bps = f"{gross_bps:+.2f}bps",
                    net_usd   = f"${net_usd:+.4f}",
                    buy_venue = buy,
                    sell_venue= sell,
                )
            except Exception as e:
                print(f"[shadow_v2] Discord alert failed: {e}")

            if mode == "SHADOW":
                log_trade(opp, mode, "EXECUTE", result="shadow_win",
                          note=f"on-chain quoted net ${net_usd:.4f}")
                print(f"  [SHADOW] ✓ logged")

            else:
                # ── Live execution ─────────────────────────────────────────────
                exec_opp = {
                    "pair":                opp.get("pair"),
                    "buy_venue":           opp.get("buyVenue"),
                    "sell_venue":          opp.get("sellVenue"),
                    "gross_bps":           gross_bps,
                    "net_profit_usd":      net_usd,
                    "trade_size_usd":      size,
                    "buy_price":           0,
                    "sell_price":          0,
                    "session_id":          ts,
                    "contract_buy_venue":  opp.get("contractBuyVenue", 0),
                    "contract_sell_venue": opp.get("contractSellVenue", 1),
                    "flash_asset":         opp.get("flashAsset", ""),
                }

                result   = executor.execute(exec_opp)
                success  = result.get("success", False)
                reverted = result.get("reverted", False)
                skipped  = result.get("skipped", False)
                tx_hash  = result.get("tx_hash", "")
                reason   = result.get("reason") or result.get("error", "")
                actual   = result.get("actual_usd", net_usd)

                if skipped:
                    log_trade(opp, mode, "SKIP", note=reason)
                    print(f"  [LIVE] SKIP -- {reason}")

                elif success:
                    log_trade(opp, mode, "EXECUTE", result="success",
                              tx_hash=tx_hash, note=f"actual ${actual}")
                    print(f"  [LIVE] ✅ SUCCESS | tx={tx_hash[:20]}...")
                    try:
                        _discord.live_execute(
                            pair          = pair,
                            gross_bps     = f"{gross_bps:+.2f}",
                            simulated_usd = net_usd,
                            actual_usd    = float(actual),
                            tx_hash       = tx_hash,
                            gas_eth       = "0.00005",
                            session_id    = ts,
                        )
                    except Exception as e:
                        print(f"  Discord live_execute notify failed: {e}")

                elif reverted:
                    log_trade(opp, mode, "EXECUTE", result="revert",
                              tx_hash=tx_hash, note=reason)
                    print(f"  [LIVE] REVERT -- {reason}")
                    try:
                        _discord.live_revert(pair=pair, gross_bps=f"{gross_bps:+.2f}",
                                             session_id=ts)
                    except Exception:
                        pass

                else:
                    log_trade(opp, mode, "EXECUTE", result="error", note=reason)
                    print(f"  [LIVE] ERROR -- {reason}")
                    try:
                        _discord.error(reason, component=f"live_executor {pair}")
                    except Exception:
                        pass

            if args.once:
                break

            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        print("\n[shadow_v2] Interrupted")

    finally:
        # ── Shutdown notification ──────────────────────────────────────────────
        try:
            _discord.shutdown(reason="shadow_mode_v2 stopped")
        except Exception:
            pass
        print(f"[shadow_v2] Stopped. Executions this session: {exec_count}")


if __name__ == "__main__":
    main()
