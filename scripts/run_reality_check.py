#!/usr/bin/env python3
"""
RC-1 Reality Check Runner v2
=============================
Wires live Redis data → real preflight → real V2 sim → honest report.

Usage:
    python3 scripts/run_reality_check.py --single --tier 1000
    python3 scripts/run_reality_check.py --minutes 10 --tier 5000
    python3 scripts/run_reality_check.py --minutes 10 --tier 1000 --speed slow
"""

import argparse
import json
import logging
import os
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Tuple

import redis

# --- Path setup ---
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "market"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "execution"))

# --- Market layer ---
from market.raw_market_state import RawMarketState
from market.redis_adapters import uniswap_v3, sushiswap_v2
from market.market_snapshot import MarketSnapshotV1
from market.market_types import TokenRef, MarketType

# --- Execution layer ---
from execution.preflight import preflight_check, PreflightDecision
from execution.preflight_policy import PreflightPolicyV1
from execution.gas_model import GasModelV1, DEFAULT_GAS_MODEL
from execution.route_simulator import (
    simulate_route,
    create_two_hop_route,
    V2PoolState,
    SimContext,
    SimResult,
)

REAL_PREFLIGHT  = True
REAL_SIMULATOR  = True

# ─────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("Allmight.RC1")

# ─────────────────────────────────────────────
# Data structures
# ─────────────────────────────────────────────

@dataclass
class CrossVenueCandidate:
    pair: str
    buy_venue: str
    sell_venue: str
    buy_market: RawMarketState
    sell_market: RawMarketState
    spread_bps: float
    gross_edge_bps: float        # spread minus swap fees
    notional_usd: float
    estimated_gas_usd: float


@dataclass
class NearMiss:
    """Candidate that died before reaching preflight — for diagnostics."""
    pair: str
    buy_venue: str
    sell_venue: str
    buy_price: float
    sell_price: float
    spread_bps: float
    total_fee_bps: float
    gross_edge_bps: float        # negative = died here
    kill_reason: str


@dataclass
class PipelineResult:
    candidate: CrossVenueCandidate
    preflight_code: str
    sim_code: Optional[str]
    net_edge_bps: Optional[float]
    survived: bool


@dataclass
class RCSession:
    run_id: str
    started_at_utc: str
    args: dict

    cycles_total: int = 0
    snapshots_ingested: int = 0
    snapshots_warned: int = 0

    # Near-misses (died at gross edge check)
    near_misses: List[NearMiss] = field(default_factory=list)
    near_miss_closest_bps: Optional[float] = None  # closest to zero (least negative)

    candidates_detected: int = 0
    preflight_accept: int = 0
    preflight_reject: int = 0
    preflight_codes: Counter = field(default_factory=Counter)

    sim_ok: int = 0
    sim_fail: int = 0
    sim_codes: Counter = field(default_factory=Counter)

    survivors: int = 0
    survivor_details: List[dict] = field(default_factory=list)
    net_edges_bps: List[float] = field(default_factory=list)
    gas_estimates_usd: List[float] = field(default_factory=list)
    adapter_warnings: Counter = field(default_factory=Counter)


# ─────────────────────────────────────────────
# Gas cost from oracle
# ─────────────────────────────────────────────

def estimate_gas_cost_usd(redis_client, speed: str = "fast") -> float:
    """
    Read gas cost from gasPriceOracle Redis key.
    Uses oracle threshold table (flashLoanSimple) when available.
    Falls back to GasModelV1 static estimate.
    """
    FALLBACK_USD = 2.0

    try:
        raw = redis_client.get("fetcher:gasPriceOracle")
        if not raw:
            logger.warning("Gas oracle not in Redis, using fallback $%.2f", FALLBACK_USD)
            return FALLBACK_USD

        payload = json.loads(raw)
        data = payload.get("data", {}).get("data", {})

        # Prefer oracle threshold table
        threshold_usd = (
            data.get("thresholds", {})
                .get("flashLoanSimple", {})
                .get(speed, {})
                .get("gasCostUSD")
        )
        if threshold_usd is not None and float(threshold_usd) > 0:
            gas_usd = float(threshold_usd)
            logger.info(f"Gas estimate (oracle threshold, {speed}): ${gas_usd:.4f}")
            return gas_usd

        # Fallback: GasModelV1 static estimate
        gas_usd = DEFAULT_GAS_MODEL.estimate_gas_cost_usd("sushiswap", "eth", 1000)
        logger.warning(f"Oracle threshold missing, using GasModelV1 static: ${gas_usd:.4f}")
        return gas_usd

    except Exception as e:
        logger.warning("Gas estimate failed (%s), using fallback $%.2f", e, FALLBACK_USD)
        return FALLBACK_USD


# ─────────────────────────────────────────────
# RawMarketState → MarketSnapshotV1
# ─────────────────────────────────────────────

def rms_to_snapshot(rms: RawMarketState) -> Optional[MarketSnapshotV1]:
    """
    Convert RawMarketState to MarketSnapshotV1.
    Returns None if critical fields missing.
    """
    try:
        mid = rms.mid_px
        fee = rms.swap_fee_bps

        # Derive tiered prices from mid + slippage estimates
        # buy_px > mid (you pay more), sell_px < mid (you receive less)
        def buy_px(slip_bps):
            s = slip_bps if slip_bps is not None else fee * 2
            return round(mid * (1 + s / 10_000), 8)

        def sell_px(slip_bps):
            s = slip_bps if slip_bps is not None else fee * 2
            return round(mid * (1 - s / 10_000), 8)

        snap = MarketSnapshotV1(
            ts_ms        = rms.ts_ms,
            chain_id     = rms.chain_id,
            venue_id     = rms.venue_id,
            market_id    = rms.market_id,
            market_type  = MarketType.AMM,
            base_token   = TokenRef(symbol=rms.base_token, address="", decimals=18),
            quote_token  = TokenRef(symbol=rms.quote_token, address="", decimals=6),
            mid_px       = mid,
            buy_px_1k    = buy_px(rms.slippage_bps_1k),
            sell_px_1k   = sell_px(rms.slippage_bps_1k),
            buy_px_5k    = buy_px(rms.slippage_bps_5k),
            sell_px_5k   = sell_px(rms.slippage_bps_5k),
            buy_px_10k   = buy_px(rms.slippage_bps_10k),
            sell_px_10k  = sell_px(rms.slippage_bps_10k),
            slippage_bps_1k  = rms.slippage_bps_1k  or fee * 2,
            slippage_bps_5k  = rms.slippage_bps_5k  or fee * 2,
            slippage_bps_10k = rms.slippage_bps_10k or fee * 2,
            swap_fee_bps = fee,
        )
        return snap
    except Exception as e:
        logger.warning(f"rms_to_snapshot failed for {rms.pair}@{rms.venue_id}: {e}")
        return None


# ─────────────────────────────────────────────
# RawMarketState → V2PoolState (for simulator)
# ─────────────────────────────────────────────

def rms_to_v2_pool_state(rms: RawMarketState) -> Optional[V2PoolState]:
    """Build V2PoolState from RawMarketState pool_state dict."""
    try:
        ps = rms.pool_state or {}
        if ps.get("type") != "v2":
            return None
        if not ps.get("reserves_available"):
            return None
        r0 = ps.get("reserve0")
        r1 = ps.get("reserve1")
        if not r0 or not r1:
            return None
        return V2PoolState(
            pool_id    = rms.market_id,
            reserve0   = int(r0),
            reserve1   = int(r1),
            fee_bps    = rms.swap_fee_bps,
            token0     = rms.base_token,
            token1     = rms.quote_token,
            block_ref  = rms.block_ref,
        )
    except Exception as e:
        logger.debug(f"rms_to_v2_pool_state failed: {e}")
        return None


# ─────────────────────────────────────────────
# Detection
# ─────────────────────────────────────────────

def detect_cross_venue(
    all_markets: List[RawMarketState],
    notional_usd: float,
    gas_cost_usd: float,
    session: RCSession,
) -> List[CrossVenueCandidate]:
    """
    Find cross-venue candidates. Also records near-misses for diagnostics.
    Near-miss = gross_edge_bps < 0 (fees ate the spread) — still valuable signal.
    """
    candidates = []
    by_pair: Dict[str, List[RawMarketState]] = defaultdict(list)
    for m in all_markets:
        by_pair[m.pair].append(m)

    for pair, markets in by_pair.items():
        if len(markets) < 2:
            continue
        for i in range(len(markets)):
            for j in range(i + 1, len(markets)):
                a, b = markets[i], markets[j]
                if a.venue_id == b.venue_id:
                    continue
                for buy_mkt, sell_mkt in [(a, b), (b, a)]:
                    ratio = sell_mkt.mid_px / buy_mkt.mid_px
                    if ratio <= 1.0:
                        continue
                    raw_spread_bps  = (ratio - 1.0) * 10_000
                    total_fee_bps   = buy_mkt.swap_fee_bps + sell_mkt.swap_fee_bps
                    gross_edge_bps  = raw_spread_bps - total_fee_bps

                    if gross_edge_bps <= 0:
                        # Record as near-miss for diagnostics
                        nm = NearMiss(
                            pair           = pair,
                            buy_venue      = buy_mkt.venue_id,
                            sell_venue     = sell_mkt.venue_id,
                            buy_price      = buy_mkt.mid_px,
                            sell_price     = sell_mkt.mid_px,
                            spread_bps     = round(raw_spread_bps, 3),
                            total_fee_bps  = round(total_fee_bps, 3),
                            gross_edge_bps = round(gross_edge_bps, 3),
                            kill_reason    = "GROSS_EDGE_NEGATIVE",
                        )
                        session.near_misses.append(nm)
                        continue

                    candidates.append(CrossVenueCandidate(
                        pair            = pair,
                        buy_venue       = buy_mkt.venue_id,
                        sell_venue      = sell_mkt.venue_id,
                        buy_market      = buy_mkt,
                        sell_market     = sell_mkt,
                        spread_bps      = round(raw_spread_bps, 3),
                        gross_edge_bps  = round(gross_edge_bps, 3),
                        notional_usd    = notional_usd,
                        estimated_gas_usd = gas_cost_usd,
                    ))

    # Track closest near-miss
    if session.near_misses:
        closest = max(session.near_misses, key=lambda x: x.gross_edge_bps)
        session.near_miss_closest_bps = closest.gross_edge_bps

    # Dedup: keep best gross edge per (pair, buy_venue, sell_venue)
    seen = {}
    for c in candidates:
        key = (c.pair, c.buy_venue, c.sell_venue)
        if key not in seen or c.gross_edge_bps > seen[key].gross_edge_bps:
            seen[key] = c

    result = sorted(seen.values(), key=lambda x: x.gross_edge_bps, reverse=True)
    return result


# ─────────────────────────────────────────────
# Single scan cycle
# ─────────────────────────────────────────────

def run_scan_cycle(
    rc_session: RCSession,
    redis_client,
    notional_usd: float,
    gas_cost_usd: float,
    policy: PreflightPolicyV1,
    gas_model: GasModelV1,
    warn_fn=None,
) -> None:
    rc_session.cycles_total += 1

    # --- Ingest ---
    all_markets: List[RawMarketState] = []
    for adapter in [uniswap_v3, sushiswap_v2]:
        markets = adapter.parse(redis_client, warn_fn=warn_fn)
        for m in markets:
            rc_session.snapshots_ingested += 1
            if m.warnings:
                rc_session.snapshots_warned += 1
                for w in m.warnings:
                    rc_session.adapter_warnings[w] += 1
        all_markets.extend(markets)

    if not all_markets:
        logger.warning("No markets ingested this cycle — check fetchers")
        return

    logger.info(f"Cycle {rc_session.cycles_total}: ingested {len(all_markets)} markets "
                f"({rc_session.snapshots_warned} warned)")

    # --- Detect ---
    candidates = detect_cross_venue(all_markets, notional_usd, gas_cost_usd, rc_session)
    rc_session.candidates_detected += len(candidates)
    logger.info(f"  Detected {len(candidates)} gross-positive candidates "
                f"({len(rc_session.near_misses)} near-misses filtered by fees)")

    # --- Preflight + Sim ---
    tier_usd = int(notional_usd)

    for cand in candidates:
        snap_buy  = rms_to_snapshot(cand.buy_market)
        snap_sell = rms_to_snapshot(cand.sell_market)

        if snap_buy is None or snap_sell is None:
            rc_session.preflight_codes["SNAPSHOT_BUILD_FAILED"] += 1
            rc_session.preflight_reject += 1
            continue

        # Real preflight
        try:
            decision: PreflightDecision = preflight_check(
                snapshot_buy  = snap_buy,
                snapshot_sell = snap_sell,
                tier_usd      = tier_usd,
                policy        = policy,
                gas_model     = gas_model,
            )
            pf_code    = decision.result
            net_edge   = decision.net_edge_bps
        except Exception as e:
            logger.warning(f"Preflight error: {e}")
            pf_code, net_edge = "PREFLIGHT_ERROR", None

        # Map result to code string for reporting
        if hasattr(decision, "rejection_reason_code") and decision.rejection_reason_code:
            pf_code = decision.rejection_reason_code

        rc_session.preflight_codes[pf_code] += 1

        if pf_code not in ("ACCEPT_SIM_ONLY", "ACCEPT_BUNDLE"):
            rc_session.preflight_reject += 1
            continue

        rc_session.preflight_accept += 1
        rc_session.gas_estimates_usd.append(cand.estimated_gas_usd)

        # Real V2 sim (Sushiswap side only — V3 needs sqrtPriceX96)
        sim_code = "SIM_SKIPPED"
        sim_net_edge = net_edge

        buy_pool  = rms_to_v2_pool_state(cand.buy_market)
        sell_pool = rms_to_v2_pool_state(cand.sell_market)

        if cand.buy_market.pool_state and cand.buy_market.pool_state.get("type") == "v3":
            sim_code = "SIM_V3_NEEDS_SQRT_PRICE"
        elif buy_pool is None:
            sim_code = "SIM_V2_POOL_STATE_MISSING"
        else:
            try:
                amount_in_wei = int(notional_usd * 1e6)  # USDC-denominated approximation
                context = SimContext(
                    block_ref            = cand.buy_market.block_ref or 0,
                    chain_id             = cand.buy_market.chain_id,
                    slippage_tolerance_bps = 50.0,
                )
                pool_states = {buy_pool.pool_id: buy_pool}
                if sell_pool:
                    pool_states[sell_pool.pool_id] = sell_pool

                route = create_two_hop_route(
                    leg1_pool_id  = buy_pool.pool_id,
                    leg1_token_in = cand.buy_market.base_token,
                    leg1_token_out= cand.buy_market.quote_token,
                    leg2_pool_id  = sell_pool.pool_id if sell_pool else buy_pool.pool_id,
                    leg2_token_in = cand.sell_market.base_token,
                    leg2_token_out= cand.sell_market.quote_token,
                    amount_in     = amount_in_wei,
                    chain_id      = cand.buy_market.chain_id,
                )
                result: SimResult = simulate_route(route, pool_states, context)
                sim_code = "SIM_OK" if result.ok else f"SIM_FAIL_{result.failure_code}"
            except Exception as e:
                sim_code = f"SIM_ERROR"
                logger.warning(f"Sim error for {cand.pair}: {e}")

        rc_session.sim_codes[sim_code] += 1
        if "OK" in sim_code or sim_code == "SIM_SKIPPED":
            rc_session.sim_ok += 1
        else:
            rc_session.sim_fail += 1

        survived = (sim_net_edge is not None and sim_net_edge > 5.0)
        if survived:
            rc_session.survivors += 1
            rc_session.net_edges_bps.append(sim_net_edge)
            rc_session.survivor_details.append({
                "pair"          : cand.pair,
                "buy_venue"     : cand.buy_venue,
                "sell_venue"    : cand.sell_venue,
                "spread_bps"    : cand.spread_bps,
                "gross_edge_bps": cand.gross_edge_bps,
                "net_edge_bps"  : round(sim_net_edge, 3),
                "notional_usd"  : cand.notional_usd,
                "gas_usd"       : cand.estimated_gas_usd,
                "sim_code"      : sim_code,
            })
            logger.info(f"  ⚡ SURVIVOR: {cand.pair} "
                        f"buy={cand.buy_venue} sell={cand.sell_venue} "
                        f"net={sim_net_edge:.2f}bps")


# ─────────────────────────────────────────────
# Report
# ─────────────────────────────────────────────

def write_report(session: RCSession, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
    report_path = output_dir / f"{ts}_report.txt"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    total_pf  = session.preflight_accept + session.preflight_reject
    pf_rate   = (session.preflight_accept / total_pf * 100) if total_pf else 0
    total_sim = session.sim_ok + session.sim_fail
    sim_rate  = (session.sim_ok / total_sim * 100) if total_sim else 0

    if session.net_edges_bps:
        edges     = sorted(session.net_edges_bps)
        edge_min  = edges[0]
        edge_avg  = sum(edges) / len(edges)
        edge_p95  = edges[min(int(len(edges)*0.95), len(edges)-1)]
    else:
        edge_min = edge_avg = edge_p95 = None

    gas_avg = sum(session.gas_estimates_usd)/len(session.gas_estimates_usd) if session.gas_estimates_usd else None

    lines = [
        "=" * 70,
        "  PROJECT ALLMIGHT — RC-1 REALITY CHECK REPORT",
        "=" * 70,
        f"  Generated : {now}",
        f"  Run ID    : {session.run_id}",
        f"  Args      : {session.args}",
        f"  Preflight : REAL",
        f"  Simulator : REAL (V2) / stub (V3 — needs sqrtPriceX96)",
        "",
        "─" * 70,
        "  INGESTION",
        "─" * 70,
        f"  Cycles run              : {session.cycles_total}",
        f"  Snapshots ingested      : {session.snapshots_ingested}",
        f"  Snapshots with warnings : {session.snapshots_warned}",
        "",
        "─" * 70,
        "  DETECTION",
        "─" * 70,
        f"  Gross-positive candidates : {session.candidates_detected}",
        f"  Near-misses (fee-killed)  : {len(session.near_misses)}",
    ]

    if session.near_miss_closest_bps is not None:
        lines.append(f"  Closest near-miss        : {session.near_miss_closest_bps:.2f} bps "
                     f"(negative = fees exceeded spread by this amount)")

    # Near-miss detail table
    if session.near_misses:
        # Deduplicate near-misses, keep closest per pair+venue combo
        nm_seen = {}
        for nm in session.near_misses:
            key = (nm.pair, nm.buy_venue, nm.sell_venue)
            if key not in nm_seen or nm.gross_edge_bps > nm_seen[key].gross_edge_bps:
                nm_seen[key] = nm
        top_nm = sorted(nm_seen.values(), key=lambda x: x.gross_edge_bps, reverse=True)[:8]

        lines += ["", "  Top near-misses (closest to profitable):"]
        lines.append(f"  {'PAIR':<12} {'BUY':>14} {'SELL':>14} {'SPREAD':>8} {'FEES':>7} {'EDGE':>8}  BUY_PX → SELL_PX")
        lines.append("  " + "─" * 80)
        for nm in top_nm:
            lines.append(
                f"  {nm.pair:<12} {nm.buy_venue:>14} {nm.sell_venue:>14} "
                f"{nm.spread_bps:>7.2f}  {nm.total_fee_bps:>6.1f} {nm.gross_edge_bps:>8.2f}  "
                f"{nm.buy_price:.4f} → {nm.sell_price:.4f}"
            )
        lines.append("")
        lines.append("  To make these profitable you need EITHER:")
        lines.append("   a) Spread > total fees  (needs market volatility or different pairs)")
        lines.append("   b) Lower fee venue      (L2s: ~1-5 bps gas vs 30 bps mainnet swap fee)")

    lines += [
        "",
        "─" * 70,
        "  PREFLIGHT",
        "─" * 70,
        f"  Accept : {session.preflight_accept}  ({pf_rate:.1f}%)",
        f"  Reject : {session.preflight_reject}",
        "",
        "  Codes:",
    ]
    for code, count in session.preflight_codes.most_common(10):
        lines.append(f"    {code:<45} {count}")

    lines += [
        "",
        "─" * 70,
        "  SIMULATION",
        "─" * 70,
        f"  Sim OK    : {session.sim_ok}",
        f"  Sim FAIL  : {session.sim_fail}",
        "",
        "  Codes:",
    ]
    for code, count in session.sim_codes.most_common(10):
        lines.append(f"    {code:<45} {count}")

    lines += [
        "",
        "─" * 70,
        "  SURVIVORS",
        "─" * 70,
        f"  Count : {session.survivors}",
    ]
    if session.survivors == 0:
        lines.append("  Zero survivors = filters honest. See near-misses above.")
    if edge_min is not None:
        lines += [f"  net edge min={edge_min:.2f} avg={edge_avg:.2f} p95={edge_p95:.2f} bps"]
    for s in session.survivor_details[:10]:
        lines.append(f"    {s['pair']:<12} buy={s['buy_venue']:<14} sell={s['sell_venue']:<14} "
                     f"net={s['net_edge_bps']:.2f}bps")

    lines += [
        "",
        "─" * 70,
        "  GAS MODEL",
        "─" * 70,
    ]
    if gas_avg:
        lines.append(f"  Avg gas (USD)           : ${gas_avg:.4f}")
        lines.append(f"  Gas @ $1k tier (bps)    : {(gas_avg/1000)*10000:.1f}")
        lines.append(f"  Gas @ $5k tier (bps)    : {(gas_avg/5000)*10000:.1f}")
        lines.append(f"  Gas @ $10k tier (bps)   : {(gas_avg/10000)*10000:.1f}")
    else:
        lines.append("  No candidates reached preflight — see near-misses for root cause.")

    if session.adapter_warnings:
        lines += ["", "─" * 70, "  ADAPTER WARNINGS", "─" * 70]
        for code, count in session.adapter_warnings.most_common():
            lines.append(f"    {code:<45} {count}")

    lines += ["", "=" * 70, "  END OF REPORT", "=" * 70]

    text = "\n".join(lines)
    report_path.write_text(text)
    print(text)
    print(f"\n📄 Report saved: {report_path}")
    return report_path


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--minutes",    type=float, default=10)
    parser.add_argument("--interval",  type=float, default=10)
    parser.add_argument("--tier",      type=float, default=1000)
    parser.add_argument("--speed",     type=str,   default="fast",
                        choices=["slow","standard","fast","instant"])
    parser.add_argument("--redis-url", type=str,
                        default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"))
    parser.add_argument("--report-dir",type=str,   default="reports/reality_check")
    parser.add_argument("--single",    action="store_true")
    args = parser.parse_args()

    try:
        r = redis.from_url(args.redis_url)
        r.ping()
        logger.info(f"✓ Redis connected: {args.redis_url}")
    except Exception as e:
        logger.error(f"Cannot connect to Redis: {e}")
        sys.exit(1)

    keys = r.keys("fetcher:*")
    if not keys:
        logger.error("No fetcher:* keys in Redis. Run: node scripts/master-fetcher.js once")
        sys.exit(1)

    # Policy: use defaults but set allowed_tiers explicitly
    policy = PreflightPolicyV1()
    policy.allowed_tiers = {int(args.tier)}

    gas_model = DEFAULT_GAS_MODEL

    run_id = f"RC1_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    session = RCSession(
        run_id=run_id,
        started_at_utc=datetime.now(timezone.utc).isoformat(),
        args={"minutes": args.minutes, "tier_usd": args.tier,
              "speed": args.speed, "redis_url": args.redis_url},
    )

    gas_cost_usd = estimate_gas_cost_usd(r, speed=args.speed)
    logger.info(f"Gas estimate ({args.speed}): ${gas_cost_usd:.4f}")
    logger.info(f"Preflight: REAL | Simulator: REAL (V2)")

    print(f"\n{'='*60}")
    print(f"  RC-1 REALITY CHECK v2")
    print(f"  Tier: ${args.tier:,.0f}  Speed: {args.speed}  Gas: ${gas_cost_usd:.4f}")
    print(f"{'='*60}\n")

    end_time = time.time() + (args.minutes * 60)
    warn_counts: Counter = Counter()

    try:
        while True:
            gas_cost_usd = estimate_gas_cost_usd(r, speed=args.speed)
            run_scan_cycle(session, r, args.tier, gas_cost_usd, policy, gas_model,
                           warn_fn=lambda c, d: warn_counts.update([c]))
            if args.single or time.time() >= end_time:
                break
            logger.info(f"  Sleeping {args.interval}s...")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        logger.info("Interrupted — generating report...")

    write_report(session, Path(PROJECT_ROOT / args.report_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
