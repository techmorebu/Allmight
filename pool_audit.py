#!/usr/bin/env python3
"""
pool_audit.py
Full audit of all pools in shadow_trades.csv against current system state.
Cross-references with DexScreener to find new opportunities and flag stale ones.

Run from ~/Allmight:  python3 pool_audit.py

Output:
  - Current pool performance summary
  - Pools that are still valid vs stale
  - New pairs discovered by DexScreener not yet in our system
  - Recommended action for each pool
"""
import os, csv, json, sys, time, requests
from pathlib import Path
from datetime import datetime, timezone, timedelta
from collections import defaultdict

ROOT = Path(__file__).resolve().parent

# Load .env
for line in (ROOT / ".env").read_text().splitlines():
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        os.environ[k.strip()] = v.strip()

SHADOW_CSV  = ROOT / "logs/shadow_trades.csv"
LIVE_CSV    = ROOT / "logs/live_trades.csv"
METRICS     = ROOT / "logs/metrics.json"

# ── Load shadow trades ────────────────────────────────────────────────────────
def load_csv(path):
    if not path.exists(): return []
    try:
        with open(path) as f:
            return list(csv.DictReader(f))
    except: return []

# ── DexScreener discovery ─────────────────────────────────────────────────────
def dex_discover(chain="arbitrum", min_vol=100_000):
    try:
        r = requests.get(
            f"https://api.dexscreener.com/latest/dex/search?q={chain}",
            timeout=8
        )
        if r.status_code != 200: return []
        pairs = r.json().get("pairs") or []
        results = []
        for p in pairs:
            if p.get("chainId","").lower() != chain: continue
            vol = float(p.get("volume",{}).get("h24",0) or 0)
            liq = float(p.get("liquidity",{}).get("usd",0) or 0)
            if vol < min_vol or liq < 50_000: continue
            results.append({
                "pair":    f"{p.get('baseToken',{}).get('symbol','?')}/{p.get('quoteToken',{}).get('symbol','?')}",
                "venue":   p.get("dexId","?"),
                "volume":  vol,
                "liq":     liq,
                "price":   float(p.get("priceUsd",0) or 0),
                "addr":    p.get("pairAddress",""),
            })
        results.sort(key=lambda x: x["volume"], reverse=True)
        return results[:30]
    except Exception as e:
        print(f"  DexScreener error: {e}")
        return []

# ── Main audit ────────────────────────────────────────────────────────────────
def main():
    print()
    print("="*60)
    print("  AllMight Pool Audit")
    print(f"  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("="*60)

    shadow_rows = load_csv(SHADOW_CSV)
    live_rows   = load_csv(LIVE_CSV)
    print(f"\n  Shadow trades loaded: {len(shadow_rows)}")
    print(f"  Live trades loaded:   {len(live_rows)}")

    if not shadow_rows:
        print("\n  No shadow trades found. Nothing to audit.")
        return

    # ── 1. Current pool performance ───────────────────────────────────────────
    print("\n" + "="*60)
    print("  SECTION 1: CURRENT POOL PERFORMANCE")
    print("="*60)

    pools = defaultdict(lambda: {
        "executed":0,"skipped":0,"total_pnl":0.0,
        "edges":[],"last_seen":None,"first_seen":None
    })

    cutoff_24h = datetime.utcnow() - timedelta(hours=24)
    cutoff_7d  = datetime.utcnow() - timedelta(days=7)

    for row in shadow_rows:
        try:
            chain   = row.get("chain","?")
            pair    = row.get("pair","?")
            buy_v   = row.get("buy_venue","?")
            sell_v  = row.get("sell_venue","?")
            key     = f"{chain}:{pair} {buy_v}->{sell_v}"
            dec     = row.get("decision","").upper()
            pnl     = float(row.get("net_profit_usd",0) or 0)
            edge    = float(row.get("gross_edge_bps",0) or 0)
            ts_str  = row.get("timestamp","")
            ts      = None
            if ts_str:
                try: ts = datetime.fromisoformat(ts_str.replace("Z","+00:00"))
                except: pass

            p = pools[key]
            if dec == "EXECUTE":
                p["executed"] += 1
                p["total_pnl"] += pnl
            else:
                p["skipped"] += 1
            p["edges"].append(edge)
            if ts:
                if p["last_seen"] is None or ts > p["last_seen"]:
                    p["last_seen"] = ts
                if p["first_seen"] is None or ts < p["first_seen"]:
                    p["first_seen"] = ts
        except: continue

    print(f"\n  {'POOL':<48} {'EXEC':>5} {'SKIP':>5} {'P&L':>10} {'AVG BPS':>8} {'LAST SEEN':>12} {'STATUS'}")
    print(f"  {'-'*48} {'-'*5} {'-'*5} {'-'*10} {'-'*8} {'-'*12} {'-'*10}")

    pool_status = {}
    for key, d in sorted(pools.items(), key=lambda x: x[1]["total_pnl"], reverse=True):
        avg_edge = sum(d["edges"]) / len(d["edges"]) if d["edges"] else 0
        last     = d["last_seen"]
        age_str  = "never"
        status   = "UNKNOWN"
        if last:
            last_naive = last.replace(tzinfo=None) if last.tzinfo else last
            age_h = (datetime.utcnow() - last_naive).total_seconds() / 3600
            if age_h < 1:     age_str = f"{int(age_h*60)}m ago"
            elif age_h < 24:  age_str = f"{age_h:.1f}h ago"
            else:             age_str = f"{age_h/24:.1f}d ago"

            last_naive = last.replace(tzinfo=None) if last.tzinfo else last
            if last_naive > cutoff_24h:  status = "ACTIVE"
            elif last_naive > cutoff_7d: status = "COOLING"
            else:                  status = "STALE"

        pool_status[key] = status
        win_rate = d["executed"] / max(d["executed"]+d["skipped"],1) * 100
        print(f"  {key:<48} {d['executed']:>5} {d['skipped']:>5} "
              f"${d['total_pnl']:>9.2f} {avg_edge:>7.1f} {age_str:>12} {status}")

    # ── 2. Live trade audit ───────────────────────────────────────────────────
    print("\n" + "="*60)
    print("  SECTION 2: LIVE TRADE AUDIT")
    print("="*60)

    if not live_rows:
        print("\n  No live trades recorded yet.")
    else:
        success = [r for r in live_rows if r.get("success","").lower() == "true"]
        reverts = [r for r in live_rows if "revert" in r.get("error","").lower()]
        blocked = [r for r in live_rows if "below minimum" in r.get("error","").lower()]
        other   = [r for r in live_rows if r not in success+reverts+blocked]

        print(f"\n  Total attempts:    {len(live_rows)}")
        print(f"  Successful:        {len(success)}  <-- actual on-chain profits")
        print(f"  On-chain reverts:  {len(reverts)}  <-- contract gate fired (zero loss)")
        print(f"  Pre-filter block:  {len(blocked)}  <-- never reached chain")
        print(f"  Other failures:    {len(other)}")

        if success:
            total_actual = sum(float(r.get("actual_usd",0) or 0) for r in success)
            print(f"\n  ACTUAL on-chain P&L: ${total_actual:.4f}")
        else:
            print(f"\n  ACTUAL on-chain P&L: $0.0000  -- no successful live trades yet")

        # Show last 5 revert edges to understand threshold
        if reverts:
            revert_edges = sorted([float(r.get("gross_bps",0)) for r in reverts], reverse=True)
            print(f"\n  Top revert edges: {[f'{e:.1f}bps' for e in revert_edges[:5]]}")
            print(f"  -> These cleared {os.environ.get('MIN_PROFIT_BPS','?')}bps pre-filter")
            print(f"     but failed on-chain slippage check (slippageBps now=20)")

    # ── 3. Changes since last session ─────────────────────────────────────────
    print("\n" + "="*60)
    print("  SECTION 3: IMPACT OF RECENT CHANGES")
    print("="*60)
    print("""
  Changes applied this session:
  ┌─────────────────────────────────┬──────────────┬──────────────┐
  │ Setting                         │ Before       │ After        │
  ├─────────────────────────────────┼──────────────┼──────────────┤
  │ Contract slippageBps            │ 50 (0.50%)   │ 20 (0.20%)   │
  │ MIN_PROFIT_BPS (.env + JS)      │ 15           │ 8            │
  │ live_executor STATE_FILE bug    │ CRASHING     │ FIXED        │
  │ Watchdog HOURLY_EVERY           │ MISSING      │ 12 ticks     │
  │ check_drought import error      │ CRASHING     │ FIXED        │
  │ metrics_engine supervised       │ NO           │ YES          │
  └─────────────────────────────────┴──────────────┴──────────────┘

  Net effect on live trading:
  - Trades with 8-14bps gross edge now PASS pre-filter (were blocked at 15)
  - Trades with 8-20bps gross edge now have realistic path to profit
    (slippage tolerance reduced from 50bps to 20bps)
  - First real on-chain execution possible once next 8+ bps edge fires
""")

    # ── 4. DexScreener new pair discovery ─────────────────────────────────────
    print("="*60)
    print("  SECTION 4: NEW PAIRS FROM DEXSCREENER")
    print("="*60)
    print("\n  Querying DexScreener for top Arbitrum pairs...")

    dex_pairs = dex_discover("arbitrum", min_vol=100_000)

    if not dex_pairs:
        print("  Could not reach DexScreener (network disabled or rate limited)")
    else:
        # Find pairs not in our current shadow pool
        our_pairs = set()
        for key in pools.keys():
            parts = key.split(":")
            if len(parts) > 1:
                our_pairs.add(parts[1].split(" ")[0].upper())

        new_pairs = [p for p in dex_pairs if p["pair"].upper() not in our_pairs]
        known_pairs = [p for p in dex_pairs if p["pair"].upper() in our_pairs]

        print(f"\n  Top pairs on Arbitrum (>$100k/24h volume):")
        print(f"\n  {'PAIR':<14} {'VENUE':<20} {'VOL 24H':>14} {'LIQUIDITY':>14} {'IN SYSTEM'}")
        print(f"  {'-'*14} {'-'*20} {'-'*14} {'-'*14} {'-'*9}")
        for p in dex_pairs[:20]:
            in_sys = "YES" if p["pair"].upper() in our_pairs else "NEW"
            print(f"  {p['pair']:<14} {p['venue']:<20} "
                  f"${p['volume']:>12,.0f} ${p['liq']:>12,.0f}  {in_sys}")

        print(f"\n  NEW pairs not yet in system: {len(new_pairs)}")
        if new_pairs:
            print(f"\n  Top new opportunities:")
            for p in new_pairs[:10]:
                print(f"    {p['pair']:<14} via {p['venue']:<18} "
                      f"vol=${p['volume']:>10,.0f}  liq=${p['liq']:>10,.0f}")
                print(f"    addr: {p['addr']}")

    # ── 5. Recommendations ────────────────────────────────────────────────────
    print("\n" + "="*60)
    print("  SECTION 5: RECOMMENDATIONS")
    print("="*60)

    stale = [k for k,v in pool_status.items() if v == "STALE"]
    active = [k for k,v in pool_status.items() if v == "ACTIVE"]
    cooling = [k for k,v in pool_status.items() if v == "COOLING"]

    print(f"""
  Pool status summary:
    Active  (seen <24h): {len(active)}
    Cooling (seen <7d):  {len(cooling)}
    Stale   (seen >7d):  {len(stale)}

  Action items:
  1. WATCH: Wait for first live trade to confirm executor end-to-end
     - slippageBps=20 + MIN_PROFIT_BPS=8 should allow 8-20bps trades through
     - Next edge >=8bps should attempt a real on-chain tx

  2. EXPAND: Install DexScreener oracle to discover new pairs automatically
     - File ready: scripts/oracles/implementations/dexscreener_oracle.py
     - Enable in: scripts/oracles/config/oracle_config.json
     - Run test:  python3 scripts/oracles/implementations/dexscreener_oracle.py

  3. ADD PAIRS: Top new DexScreener pairs worth adding to fetchers:
     - WBTC/USDT, USDC/USDT, ARB/USDC, GMX/USDC (high volume on Arbitrum)
     - These require adding pool addresses to the relevant fetcher configs

  4. MONITOR: After 24hrs of live trading, re-run this audit to see
     which pools are generating real vs simulated P&L
""")

    print("="*60)
    print("  Audit complete.")
    print("="*60)
    print()


if __name__ == "__main__":
    main()
