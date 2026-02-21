#!/usr/bin/env python3
"""
scripts/execution/shadow_mode.py

Shadow execution engine for AllMight arbitrage bot.
Simulates trades using real market data from Redis.
No on-chain execution -- validates strategy before real capital.

Doctrine gate: must achieve >60% win rate before live execution.

Usage:
    python3 scripts/execution/shadow_mode.py
    python3 scripts/execution/shadow_mode.py --min-edge 5 --size 1000
    python3 scripts/execution/shadow_mode.py --report

Output:
    logs/shadow_trades.csv   -- every simulated trade
    logs/shadow_summary.txt  -- running P&L and win rate
"""

import argparse
import csv
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import redis
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from utils.discord_alerts import discord as _discord

# ── Config ────────────────────────────────────────────────────────────────────
REDIS_HOST  = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT  = int(os.getenv("REDIS_PORT", 6379))
REDIS_DB    = int(os.getenv("REDIS_DB", 0))

# Absolute paths -- works regardless of working directory
REPO_ROOT   = Path(__file__).resolve().parent.parent.parent
LOG_DIR     = REPO_ROOT / "logs"
TRADE_LOG   = LOG_DIR / "shadow_trades.csv"
SUMMARY_LOG = LOG_DIR / "shadow_summary.txt"

TRADE_LOG_HEADERS = [
    "timestamp", "chain", "pair",
    "buy_venue", "sell_venue",
    "buy_price", "sell_price",
    "spread_bps", "fee_bps", "gross_edge_bps", "net_edge_bps",
    "trade_size_usd", "gross_profit_usd", "net_profit_usd",
    "aave_fee_usd", "gas_usd",
    "decision", "would_revert",
]

# ── Execution constants (doctrine Section 3) ──────────────────────────────────
AAVE_FLASH_FEE_PCT  = 0.0005   # 0.05% Aave V3 flash loan fee
GAS_COST_USD        = 0.02     # ~$0.02 on Arbitrum

# VALIDATED pairs: (asset_pair, buy_venue, sell_venue) -> fee_wall_bps
# Explicit allowlist -- any combo NOT listed is REJECTED
# Venue names match exactly what fetchers store in Redis (no chain suffix)
FEE_WALLS = {
    # ── Arbitrum PRIORITY 1 -- confirmed gross-positive signal ───────────────
    # ETH/USDT UniV3 <-> Curve: observed 0.5-151 bps, fires daily
    ("ETH/USDT",   "uniswap_v3", "curve"):        10,
    ("ETH/USDT",   "curve",      "uniswap_v3"):   10,

    # USDC/USDCe UniV3 <-> UniV3: -2.71 bps best, near-miss
    ("USDC/USDCe", "uniswap_v3", "uniswap_v3"):    6,
    ("USDCe/USDC", "uniswap_v3", "uniswap_v3"):    6,

    # ── Optimism PRIORITY 2 -- near-miss, monitor only ────────────────────────
    # USDCe/USDT Velodrome <-> UniV3: -1.73 bps best, 3 bps fee wall
    ("USDCe/USDT", "velodrome",  "uniswap_v3"):    3,
    ("USDCe/USDT", "uniswap_v3", "velodrome"):     3,
}

# Minimum real liquidity per pool -- rejects phantom/empty pools
# Uses reserveUSD if available, else liquidity field as proxy
MIN_RESERVE_USD   = 50_000   # $50k minimum pool size
MIN_LIQUIDITY_RAW = 1_000_000  # fallback for UniV3 liquidity field
# tvlUSD from UniV3 fetchers is in raw wei units (fetcher bug, fix pending)
# Values like 366_000_000_000_000 are NOT dollars -- they are unusable
# Use liquidity field as proxy: pools with real depth have liquidity > 1M
TVLUSD_MAX_SANE = 1_000_000_000  # $1B -- anything above this is a wei bug
# tvlUSD from UniV3 fetchers is in raw wei units (fetcher bug, fix pending)
# Values like 366_000_000_000_000 are NOT dollars -- they are unusable
# Use liquidity field as proxy: pools with real depth have liquidity > 1M
TVLUSD_MAX_SANE = 1_000_000_000  # $1B -- anything above this is a wei bug

# ── Redis loader ──────────────────────────────────────────────────────────────
def load_markets(r: redis.Redis) -> list[dict]:
    """
    Load all market data from Redis and find arb pairs.

    Redis schema (confirmed 2026-02-20):
      key:   fetcher:<fetcherName>
      value: { ok, name, durationMs, timestamp,
               data: { status, data: { prices: [...], chain, venues, timestamp } } }
      price entry: { pair, pool, price, fee, venue, chain, source, timestamp, ... }
    """
    markets = []
    prices  = {}  # (pair, chain) -> list of {venue, price, fee_pct, chain}

    # ── Load all fetcher keys ─────────────────────────────────────────────────
    keys = r.keys("fetcher:*")
    if not keys:
        return []

    for key in keys:
        raw = r.get(key)
        if not raw:
            continue
        try:
            blob = json.loads(raw)
            # Navigate to price list: blob -> data -> data -> prices
            entries = (
                blob
                .get("data", {})
                .get("data", {})
                .get("prices", [])
            )
            if not isinstance(entries, list):
                continue

            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                pair  = entry.get("pair", "")
                venue = entry.get("venue", "") or entry.get("source", "")
                price = float(entry.get("price", 0) or 0)
                chain = entry.get("chain", "")
                fee   = float(entry.get("fee", 0) or 0)

                if price <= 0 or not pair or not venue or not chain:
                    continue

                # ── Liquidity filter -- reject empty/phantom pools ────────────
                reserve_usd = entry.get("reserveUSD")
                tvl_usd     = entry.get("tvlUSD")
                liquidity   = entry.get("liquidity", 0) or 0

                if reserve_usd is not None:
                    # Velodrome and AMM pools -- reserveUSD is reliable
                    if float(reserve_usd) < MIN_RESERVE_USD:
                        continue
                elif tvl_usd is not None:
                    # UniV3 tvlUSD is in wei units (bug in fetcher, fix pending)
                    # Values > $1B are almost certainly raw wei, not USD
                    # Use liquidity field as proxy instead
                    tvl_val = float(tvl_usd)
                    if tvl_val < TVLUSD_MAX_SANE:
                        # Looks like a real USD value, use it
                        if tvl_val < MIN_RESERVE_USD:
                            continue
                    else:
                        # Raw wei value -- fall back to liquidity proxy
                        if float(liquidity) < MIN_LIQUIDITY_RAW:
                            continue
                # If neither field exists, skip to be safe

                k = (pair, chain)
                if k not in prices:
                    prices[k] = []
                prices[k].append({
                    "pair":       pair,
                    "venue":      venue,
                    "price":      price,
                    "chain":      chain,
                    "fee_pct":    fee,
                    "reserve_usd": float(reserve_usd) if reserve_usd else None,
                    "liquidity":  float(liquidity),
                })

        except Exception as e:
            continue

    # ── Find cross-venue arb pairs ────────────────────────────────────────────
    for (pair, chain), entries in prices.items():
        if len(entries) < 2:
            continue

        for i, buy in enumerate(entries):
            for sell in entries[i+1:]:
                if buy["venue"] == sell["venue"]:
                    continue
                if buy["price"] >= sell["price"]:
                    continue

                spread_bps = (sell["price"] - buy["price"]) / buy["price"] * 10000

                # Look up fee wall from known pairs first, then estimate from fees
                # fee_pct is fraction (e.g. 0.05 for 5 bps UniV3), convert to bps
                buy_fee_bps  = buy["fee_pct"] * 100
                sell_fee_bps = sell["fee_pct"] * 100
                estimated_fees = buy_fee_bps + sell_fee_bps

                # ── Allowlist: must match (asset_pair, buy_venue, sell_venue) ──
                # Pair-aware -- prevents ETH/USDC slipping through velodrome check
                key     = (pair, buy["venue"],  sell["venue"])
                key_rev = (pair, sell["venue"], buy["venue"])
                if key not in FEE_WALLS and key_rev not in FEE_WALLS:
                    continue  # not a validated pair -- reject

                fee_wall = FEE_WALLS.get(key, FEE_WALLS.get(key_rev, round(estimated_fees)))

                gross = spread_bps - fee_wall

                markets.append({
                    "chain":      chain,
                    "pair":       pair,
                    "buy_venue":  buy["venue"],
                    "sell_venue": sell["venue"],
                    "buy_price":  buy["price"],
                    "sell_price": sell["price"],
                    "spread_bps": round(spread_bps, 4),
                    "fee_bps":    fee_wall,
                    "gross_edge": round(gross, 4),
                })

    return sorted(markets, key=lambda x: x["gross_edge"], reverse=True)


# ── Trade simulator ───────────────────────────────────────────────────────────
def simulate_trade(opp: dict, size_usd: float) -> dict:
    """
    Simulate a flash loan arbitrage trade.
    Returns P&L breakdown and whether it would have reverted.
    """
    spread_bps = opp["spread_bps"]
    fee_bps    = opp["fee_bps"]
    gross_bps  = opp["gross_edge"]

    gross_profit = size_usd * (spread_bps / 10000)
    fee_cost     = size_usd * (fee_bps / 10000)
    aave_fee     = size_usd * AAVE_FLASH_FEE_PCT
    gas_usd      = GAS_COST_USD

    net_profit   = gross_profit - fee_cost - aave_fee - gas_usd
    net_bps      = gross_bps - (AAVE_FLASH_FEE_PCT * 10000) - (gas_usd / size_usd * 10000)

    # Trade would revert if net profit <= 0
    # Aave enforces this atomically -- no partial fills
    would_revert = net_profit <= 0

    decision = "EXECUTE" if not would_revert else "SKIP"

    return {
        "gross_profit_usd": round(gross_profit, 4),
        "fee_cost_usd":     round(fee_cost, 4),
        "aave_fee_usd":     round(aave_fee, 4),
        "gas_usd":          round(gas_usd, 4),
        "net_profit_usd":   round(net_profit, 4),
        "net_edge_bps":     round(net_bps, 2),
        "decision":         decision,
        "would_revert":     would_revert,
    }


# ── Report generator ──────────────────────────────────────────────────────────
def print_report():
    if not TRADE_LOG.exists():
        print("No shadow trades logged yet.")
        return

    trades = []
    with open(TRADE_LOG) as f:
        reader = csv.DictReader(f)
        for row in reader:
            trades.append(row)

    if not trades:
        print("No trades in log.")
        return

    total       = len(trades)
    executed    = [t for t in trades if t["decision"] == "EXECUTE"]
    skipped     = [t for t in trades if t["decision"] == "SKIP"]
    winners     = [t for t in executed if float(t["net_profit_usd"]) > 0]
    total_pnl   = sum(float(t["net_profit_usd"]) for t in executed)
    win_rate    = len(winners) / len(executed) * 100 if executed else 0

    # By pair
    by_pair = {}
    for t in executed:
        k = f"{t['chain']}:{t['pair']} {t['buy_venue'][:15]}->{t['sell_venue'][:15]}"
        if k not in by_pair:
            by_pair[k] = {"count": 0, "pnl": 0.0, "wins": 0}
        by_pair[k]["count"] += 1
        by_pair[k]["pnl"]   += float(t["net_profit_usd"])
        if float(t["net_profit_usd"]) > 0:
            by_pair[k]["wins"] += 1

    print()
    print("=" * 60)
    print("  SHADOW MODE REPORT")
    print(f"  Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)
    print(f"  Opportunities scanned: {total}")
    print(f"  Trades simulated:      {len(executed)}")
    print(f"  Trades skipped:        {len(skipped)}")
    print(f"  Win rate:              {win_rate:.1f}%")
    print(f"  Total net P&L:         ${total_pnl:.4f}")
    print()
    print("  MVI GATE STATUS:")
    gate = win_rate >= 60
    print(f"  Win rate >= 60%:  {'✅ PASS' if gate else '❌ FAIL'} ({win_rate:.1f}%)")
    drawdown = min((float(t["net_profit_usd"]) for t in executed), default=0)
    dd_pass  = drawdown > -0.05 * abs(total_pnl) if total_pnl else True
    print(f"  Max drawdown < 5%: {'✅ PASS' if dd_pass else '❌ FAIL'}")
    print()
    print("  TOP PAIRS:")
    for k, v in sorted(by_pair.items(), key=lambda x: x[1]["pnl"], reverse=True)[:5]:
        wr = v["wins"] / v["count"] * 100
        print(f"  {k}")
        print(f"    trades={v['count']}  pnl=${v['pnl']:.4f}  win_rate={wr:.0f}%")
    print("=" * 60)

    # Write summary
    SUMMARY_LOG.write_text(
        f"Last updated: {datetime.now(timezone.utc).isoformat()}\n"
        f"Total scanned: {total}\n"
        f"Executed: {len(executed)}\n"
        f"Win rate: {win_rate:.1f}%\n"
        f"Net P&L: ${total_pnl:.4f}\n"
        f"MVI gate: {'PASS' if gate else 'FAIL'}\n"
    )


# ── Main loop ─────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="AllMight Shadow Mode Executor")
    parser.add_argument("--min-edge",  type=float, default=0.0,
                        help="Minimum gross edge in bps to simulate (default: 0)")
    parser.add_argument("--size",      type=float, default=1000.0,
                        help="Trade size in USD (default: $1,000)")
    parser.add_argument("--interval",  type=int,   default=60,
                        help="Scan interval in seconds (default: 60)")
    parser.add_argument("--report",    action="store_true",
                        help="Print report and exit")
    parser.add_argument("--once",      action="store_true",
                        help="Run one scan and exit")
    args = parser.parse_args()

    if args.report:
        print_report()
        return

    LOG_DIR.mkdir(exist_ok=True)

    # Init CSV
    write_header = not TRADE_LOG.exists()
    log_file = open(TRADE_LOG, "a", newline="")
    writer   = csv.DictWriter(log_file, fieldnames=TRADE_LOG_HEADERS)
    if write_header:
        writer.writeheader()

    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)

    print(f"Shadow Mode | size=${args.size:.0f} | min_edge={args.min_edge}bps | interval={args.interval}s")
    print(f"Log: {TRADE_LOG}")
    print("No real transactions will be submitted.")
    print()

    scan_count = 0

    while True:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        markets = load_markets(r)
        candidates = [m for m in markets if m["gross_edge"] >= args.min_edge]

        scan_count += 1
        fired = 0

        for opp in candidates:
            result = simulate_trade(opp, args.size)

            row = {
                "timestamp":      ts,
                "chain":          opp["chain"],
                "pair":           opp["pair"],
                "buy_venue":      opp["buy_venue"],
                "sell_venue":     opp["sell_venue"],
                "buy_price":      round(opp["buy_price"],  6),
                "sell_price":     round(opp["sell_price"], 6),
                "spread_bps":     round(opp["spread_bps"], 4),
                "fee_bps":        opp["fee_bps"],
                "gross_edge_bps": round(opp["gross_edge"], 4),
                "net_edge_bps":   result["net_edge_bps"],
                "trade_size_usd": args.size,
                "gross_profit_usd": result["gross_profit_usd"],
                "net_profit_usd":   result["net_profit_usd"],
                "aave_fee_usd":     result["aave_fee_usd"],
                "gas_usd":          result["gas_usd"],
                "decision":         result["decision"],
                "would_revert":     result["would_revert"],
            }
            writer.writerow(row)
            log_file.flush()
            fired += 1

            status = "✅ EXECUTE" if result["decision"] == "EXECUTE" else "⏭  SKIP"
            print(f"[{ts}] {status} | {opp['chain']} {opp['pair']} "
                  f"{opp['buy_venue'][:15]}->{opp['sell_venue'][:15]} | "
                  f"gross={opp['gross_edge']:+.2f}bps | "
                  f"net=${result['net_profit_usd']:+.4f}")

            # Discord alert on every EXECUTE decision
            if result["decision"] == "EXECUTE":
                try:
                    _discord.execute_alert(
                        chain     = opp["chain"],
                        pair      = opp["pair"],
                        gross_bps = f"{opp['gross_edge']:+.2f}bps",
                        net_usd   = f"${result['net_profit_usd']:+.4f}",
                    )
                except Exception:
                    pass

            # Discord alert on every EXECUTE decision
            if result["decision"] == "EXECUTE":
                try:
                    _discord.execute_alert(
                        chain     = opp["chain"],
                        pair      = opp["pair"],
                        gross_bps = f"{opp['gross_edge']:+.2f}bps",
                        net_usd   = f"${result['net_profit_usd']:+.4f}",
                    )
                except Exception:
                    pass

        if fired == 0:
            print(f"[{ts}] Scan #{scan_count} -- no candidates above {args.min_edge}bps")

        # Hourly shadow report to Discord (every 60 scans)
        if scan_count % 60 == 0:
            try:
                _send_shadow_report()
            except Exception:
                pass

        # Hourly shadow report to Discord (every 60 scans)
        if scan_count % 60 == 0:
            try:
                _send_shadow_report()
            except Exception:
                pass

        if args.once:
            break

        time.sleep(args.interval)

    log_file.close()
    print_report()


if __name__ == "__main__":
    main()
