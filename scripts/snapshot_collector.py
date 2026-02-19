#!/usr/bin/env python3
"""
Snapshot Collector - Phase 2.4.0

Collects market snapshots with validation and telemetry integration.

Features:
- Validates snapshots with MarketSnapshotV1 validator
- Emits TELEMETRY_WARNING for data quality issues
- Skips snapshots on hard errors
- Writes snapshots to JSONL (append-only)
- Emits stage timing telemetry

Author: Allmight System
Phase: 2.4.0 - Telemetry Integration
"""

import sys
import os
import json
import time
from pathlib import Path
from datetime import datetime, timezone
import logging

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from telemetry.execution_telemetry import TelemetryLogger, StageTimer
from market.market_validate import validate_snapshot

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('Allmight.SnapshotCollector')


def _utc_day() -> str:
    """Get current UTC day in YYYYMMDD format"""
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def _snapshots_path() -> Path:
    """Get path to today's snapshots JSONL file"""
    day = _utc_day()
    p = Path("data/snapshots") / day / "market_snapshots.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _append_jsonl(path: Path, obj: dict):
    """Append object to JSONL file (deterministic serialization)"""
    # Convert any non-serializable objects to dicts
    serializable = {}
    for key, value in obj.items():
        if hasattr(value, '__dict__'):
            serializable[key] = value.__dict__
        else:
            serializable[key] = value
    
    line = json.dumps(serializable, sort_keys=True, separators=(",", ":"))
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def collect_snapshots_demo():
    """
    Demo snapshot collection with validation and telemetry
    
    In production, this would:
    1. Read from Redis (uniswapV3Fetcher, sushiswapFetcher)
    2. Convert pool records to MarketSnapshotV1
    3. Validate each snapshot
    4. Emit TELEMETRY_WARNING for issues
    5. Write valid snapshots to JSONL
    """
    telemetry = TelemetryLogger()
    logger.info(f"Snapshot collector initialized (run_id: {telemetry.run_id})")
    
    snapshots_out = _snapshots_path()
    
    # Demo: Create some mock snapshot data
    mock_snapshots = _create_mock_snapshots()
    
    # Stage 1: Fetch (simulated)
    with StageTimer(
        telemetry=telemetry,
        stage="SNAPSHOT_FETCH",
        opportunity_id="",
        chain_id="eth",
        venue_id="demo",
        market_id="demo",
        route_id="",
        notional_usd=0.0,
        block_ref=0,
        stage_seq=1
    ):
        logger.info(f"Fetched {len(mock_snapshots)} mock snapshots")
    
    wrote = 0
    skipped = 0
    warned = 0
    
    for snap_dict in mock_snapshots:
        # Stage 2: Validate
        with StageTimer(
            telemetry=telemetry,
            stage="SNAPSHOT_VALIDATE",
            opportunity_id="",
            chain_id=snap_dict.get("chain_id", ""),
            venue_id=snap_dict.get("venue_id", ""),
            market_id=snap_dict.get("market_id", ""),
            route_id="",
            notional_usd=0.0,
            block_ref=snap_dict.get("block_ref", 0),
            stage_seq=2
        ):
            # Create a mock snapshot object for validation
            from types import SimpleNamespace
            snap_obj = SimpleNamespace(**snap_dict)
            
            # Validate
            result = validate_snapshot(snap_obj)
        
        # Handle validation results
        if result.errors or result.warnings:
            telemetry.emit_warning(
                subsystem="snapshot_validation",
                code_namespace="SNAPSHOT_V1",
                warning_codes=result.warnings,
                error_codes=result.errors,
                chain_id=snap_dict.get("chain_id", ""),
                venue_id=snap_dict.get("venue_id", ""),
                market_id=snap_dict.get("market_id", ""),
                block_ref=snap_dict.get("block_ref"),
                context={
                    "mid_px": snap_dict.get("mid_px"),
                    "buy_px_1k": snap_dict.get("buy_px_1k"),
                    "sell_px_1k": snap_dict.get("sell_px_1k"),
                }
            )
            warned += 1
        
        # Hard errors -> skip write
        if result.errors:
            logger.warning(
                f"Skipping snapshot {snap_dict.get('market_id')} due to errors: "
                f"{result.errors}"
            )
            skipped += 1
            continue
        
        # Stage 3: Write snapshot
        with StageTimer(
            telemetry=telemetry,
            stage="SNAPSHOT_WRITE",
            opportunity_id="",
            chain_id=snap_dict.get("chain_id", ""),
            venue_id=snap_dict.get("venue_id", ""),
            market_id=snap_dict.get("market_id", ""),
            route_id="",
            notional_usd=0.0,
            block_ref=snap_dict.get("block_ref", 0),
            stage_seq=3
        ):
            _append_jsonl(snapshots_out, snap_dict)
            wrote += 1
    
    logger.info(
        f"Collection complete: wrote={wrote} skipped={skipped} warned={warned}"
    )
    
    print()
    print("=" * 80)
    print("📊 SNAPSHOT COLLECTION RESULTS")
    print("=" * 80)
    print(f"✅ Wrote: {wrote} snapshots")
    print(f"⚠️  Warned: {warned} snapshots (see telemetry_warnings.jsonl)")
    print(f"❌ Skipped: {skipped} snapshots (hard errors)")
    print()
    print(f"📄 Snapshots: {snapshots_out}")
    print(f"📄 Telemetry: data/telemetry/{_utc_day()}/")
    print("=" * 80)
    
    return wrote, warned, skipped


def _create_mock_snapshots():
    """Create mock snapshot data for demo"""
    return [
        # Valid snapshot
        {
            "chain_id": "eth",
            "venue_id": "uniswap_v3",
            "market_id": "0xpool_valid",
            "ts_ms": int(time.time() * 1000),
            "base_token": type("TokenRef", (), {"symbol": "ETH", "address": "0x...", "decimals": 18})(),
            "quote_token": type("TokenRef", (), {"symbol": "USDC", "address": "0x...", "decimals": 6})(),
            "mid_px": 2684.50,
            "buy_px_1k": 2685.20,
            "sell_px_1k": 2683.80,
            "buy_px_5k": 2686.40,
            "sell_px_5k": 2682.60,
            "buy_px_10k": 2687.80,
            "sell_px_10k": 2681.20,
            "spread_bps_1k": 52.0,
            "slippage_bps_1k": 26.0,
            "slippage_bps_5k": 70.0,
            "slippage_bps_10k": 120.0,
            "depth_usd_1pct": 50000,
            "tvl_usd": 50000000,
            "volume_usd_24h": 10000000,
            "swap_fee_bps": 30.0,
            "gas_cost_usd": 5.0,
            "latency_ms_est": 150,
            "auth_score": 10.0,
            "competition_density": 0.5,
            "recent_tx_count_60s": 100,
            "block_ref": 21876543,
        },
        # Snapshot with warnings (non-monotonic)
        {
            "chain_id": "eth",
            "venue_id": "sushiswap",
            "market_id": "0xpool_warning",
            "ts_ms": int(time.time() * 1000),
            "base_token": type("TokenRef", (), {"symbol": "ETH", "address": "0x...", "decimals": 18})(),
            "quote_token": type("TokenRef", (), {"symbol": "USDC", "address": "0x...", "decimals": 6})(),
            "mid_px": 2684.50,
            "buy_px_1k": 2690.00,  # Too high!
            "sell_px_1k": 2683.80,
            "buy_px_5k": 2686.40,
            "sell_px_5k": 2682.60,
            "buy_px_10k": 2687.80,
            "sell_px_10k": 2681.20,
            "spread_bps_1k": 52.0,
            "slippage_bps_1k": 26.0,
            "slippage_bps_5k": 70.0,
            "slippage_bps_10k": 120.0,
            "depth_usd_1pct": 50000,
            "tvl_usd": 50000000,
            "volume_usd_24h": 10000000,
            "swap_fee_bps": 30.0,
            "gas_cost_usd": 5.0,
            "latency_ms_est": 150,
            "auth_score": 10.0,
            "competition_density": 0.5,
            "recent_tx_count_60s": 100,
            "block_ref": 21876543,
        },
        # Snapshot with error (negative price)
        {
            "chain_id": "eth",
            "venue_id": "pancakeswap",
            "market_id": "0xpool_error",
            "ts_ms": int(time.time() * 1000),
            "base_token": type("TokenRef", (), {"symbol": "ETH", "address": "0x...", "decimals": 18})(),
            "quote_token": type("TokenRef", (), {"symbol": "USDC", "address": "0x...", "decimals": 6})(),
            "mid_px": -100,  # ERROR!
            "buy_px_1k": 2685.20,
            "sell_px_1k": 2683.80,
            "buy_px_5k": 2686.40,
            "sell_px_5k": 2682.60,
            "buy_px_10k": 2687.80,
            "sell_px_10k": 2681.20,
            "spread_bps_1k": 52.0,
            "slippage_bps_1k": 26.0,
            "slippage_bps_5k": 70.0,
            "slippage_bps_10k": 120.0,
            "depth_usd_1pct": 50000,
            "tvl_usd": 50000000,
            "volume_usd_24h": 10000000,
            "swap_fee_bps": 30.0,
            "gas_cost_usd": 5.0,
            "latency_ms_est": 150,
            "auth_score": 10.0,
            "competition_density": 0.5,
            "recent_tx_count_60s": 100,
            "block_ref": 21876543,
        },
    ]


if __name__ == '__main__':
    collect_snapshots_demo()
