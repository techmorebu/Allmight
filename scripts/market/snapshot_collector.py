#!/usr/bin/env python3
"""
Snapshot Collector - Gathers real market data for profiling

Connects to existing Allmight fetchers and converts to MarketSnapshot format

Author: Allmight System
Phase: 2.3A - Market Inefficiency Profiler
"""

import sys
import os
import time
import json
import redis
import logging
from typing import List, Dict, Optional
from datetime import datetime

# Add scripts directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from market_snapshot import MarketSnapshotV1
from market_types import TokenRef, MarketType
from market_storage import MarketStorage
from market_adapter import MarketAdapter, AdapterRegistry

logger = logging.getLogger('Allmight.SnapshotCollector')


class ExistingFetcherAdapter(MarketAdapter):
    """
    Adapter for existing Allmight fetchers
    
    Converts Redis data to MarketSnapshot format
    """
    
    def __init__(self, chain_id: str, venue_id: str, redis_client):
        super().__init__(chain_id, venue_id)
        self.redis_client = redis_client
    
    def fetch_market_snapshot(self, market, tiers=None):
        """Not used - we fetch all at once"""
        raise NotImplementedError("Use fetch_all_markets instead")
    
    def fetch_all_markets(self, tiers=None) -> List[MarketSnapshotV1]:
        """
        Fetch all markets from existing fetcher
        
        Returns:
            List of MarketSnapshotV1
        """
        snapshots = []
        
        # Load fetcher data from Redis
        key = f'fetcher:{self.venue_id}'
        
        try:
            raw_data = self.redis_client.get(key)
            
            if not raw_data:
                self.logger.warning(f"No data in Redis for {key}")
                return []
            
            parsed = json.loads(raw_data)
            data = parsed.get('data', {}).get('data', {})
            
            if 'prices' not in data:
                self.logger.warning(f"No prices in {key}")
                return []
            
            # Get gas cost
            gas_cost = self._get_gas_cost()
            
            # Convert each price to snapshot
            for price_data in data['prices']:
                try:
                    snapshot = self._convert_to_snapshot(price_data, gas_cost)
                    snapshots.append(snapshot)
                except Exception as e:
                    self.logger.error(f"Failed to convert {price_data.get('pair')}: {e}")
            
            self.logger.info(f"Fetched {len(snapshots)} snapshots from {self.venue_id}")
            
        except Exception as e:
            self.logger.error(f"Failed to fetch from {self.venue_id}: {e}")
        
        return snapshots
    
    def get_available_markets(self):
        """Not implemented for now"""
        return []
    
    def _get_gas_cost(self) -> float:
        """Get current gas cost from gas oracle"""
        try:
            gas_data = self.redis_client.get('fetcher:gasPriceOracle')
            if gas_data:
                parsed = json.loads(gas_data)
                return parsed.get('data', {}).get('thresholds', {}).get(
                    'flashLoanTriangle', {}
                ).get('fast', {}).get('gasCostUSD', 2.0)
        except:
            pass
        
        return 2.0  # Default
    
    def _convert_to_snapshot(self, price_data: Dict, gas_cost: float) -> MarketSnapshotV1:
        """
        Convert existing fetcher format to MarketSnapshotV1
        
        Args:
            price_data: Price data from fetcher
            gas_cost: Gas cost in USD
        
        Returns:
            MarketSnapshotV1
        """
        pair = price_data.get('pair', 'UNKNOWN/UNKNOWN')
        tokens = pair.split('/')
        
        if len(tokens) != 2:
            raise ValueError(f"Invalid pair format: {pair}")
        
        base_symbol, quote_symbol = tokens
        
        # Create token refs (addresses will be fetched from pool if needed)
        base_token = TokenRef(
            address=price_data.get('pool', 'unknown'),
            symbol=base_symbol,
            decimals=18  # Assume 18 for now
        )
        
        quote_token = TokenRef(
            address=price_data.get('pool', 'unknown'),
            symbol=quote_symbol,
            decimals=6 if quote_symbol in ['USDC', 'USDT'] else 18
        )
        
        # Get price and liquidity
        mid_px = price_data.get('price', 0)
        fee_bps = price_data.get('fee', 30)  # Default 0.3%
        tvl = price_data.get('tvlUSD') or price_data.get('reserveUSD', 0)
        
        # Estimate tiered prices with slippage
        # Simple model: slippage increases with size
        slip_1k = self._estimate_slippage(1000, tvl)
        slip_5k = self._estimate_slippage(5000, tvl)
        slip_10k = self._estimate_slippage(10000, tvl)
        
        # Buy price = mid + slippage + fee
        buy_1k = mid_px * (1 + (slip_1k + fee_bps) / 10000)
        buy_5k = mid_px * (1 + (slip_5k + fee_bps) / 10000)
        buy_10k = mid_px * (1 + (slip_10k + fee_bps) / 10000)
        
        # Sell price = mid - slippage - fee
        sell_1k = mid_px * (1 - (slip_1k + fee_bps) / 10000)
        sell_5k = mid_px * (1 - (slip_5k + fee_bps) / 10000)
        sell_10k = mid_px * (1 - (slip_10k + fee_bps) / 10000)
        
        # Spread at 1k tier
        spread_bps = ((buy_1k - sell_1k) / mid_px) * 10000
        
        # Depth estimate (rough)
        depth_1pct = tvl * 0.01  # Very rough estimate
        
        # Determine market type
        if 'v3' in self.venue_id.lower() or 'clmm' in self.venue_id.lower():
            market_type = MarketType.CLMM
        else:
            market_type = MarketType.AMM
        
        return MarketSnapshotV1(
            ts_ms=int(time.time() * 1000),
            chain_id=self.chain_id,
            venue_id=self.venue_id,
            market_id=price_data.get('pool', f"{self.venue_id}:{pair}"),
            market_type=market_type,
            base_token=base_token,
            quote_token=quote_token,
            mid_px=mid_px,
            buy_px_1k=buy_1k,
            sell_px_1k=sell_1k,
            buy_px_5k=buy_5k,
            sell_px_5k=sell_5k,
            buy_px_10k=buy_10k,
            sell_px_10k=sell_10k,
            spread_bps_1k=spread_bps,
            slippage_bps_1k=slip_1k,
            slippage_bps_5k=slip_5k,
            slippage_bps_10k=slip_10k,
            depth_usd_1pct=depth_1pct,
            tvl_usd=tvl,
            volume_usd_24h=None,
            swap_fee_bps=fee_bps,
            gas_cost_usd=gas_cost,
            latency_ms_est=100  # Placeholder
        )
    
    def _estimate_slippage(self, notional_usd: float, tvl_usd: float) -> float:
        """
        Estimate slippage based on notional and TVL
        
        Simple model: slippage = (notional / tvl) * scaling_factor
        """
        if tvl_usd == 0:
            return 100  # High slippage for zero TVL
        
        # Rough estimate
        utilization = notional_usd / tvl_usd
        
        # Slippage increases non-linearly with utilization
        slippage_bps = utilization * 1000  # Scale factor
        
        return min(slippage_bps, 500)  # Cap at 5%


class SnapshotCollector:
    """
    Collects snapshots from existing Allmight fetchers
    
    Runs in background, periodically sampling markets
    """
    
    def __init__(self, storage: MarketStorage, redis_url: str = 'redis://127.0.0.1:6379'):
        self.storage = storage
        self.redis_client = redis.from_url(redis_url, decode_responses=True)
        self.registry = AdapterRegistry()
        
        # Register adapters for existing fetchers
        self.registry.register(ExistingFetcherAdapter('eth', 'uniswapV3Fetcher', self.redis_client))
        self.registry.register(ExistingFetcherAdapter('eth', 'sushiswapFetcher', self.redis_client))
        
        logger.info("SnapshotCollector initialized")
    
    def collect_once(self) -> List[MarketSnapshotV1]:
        """
        Collect one round of snapshots from all adapters
        
        Returns:
            List of collected snapshots
        """
        logger.info("Collecting snapshots...")
        
        snapshots = self.registry.fetch_all_snapshots()
        
        if snapshots:
            self.storage.append_batch(snapshots)
            logger.info(f"Collected and stored {len(snapshots)} snapshots")
        else:
            logger.warning("No snapshots collected")
        
        return snapshots
    
    def collect_continuous(
        self,
        interval_seconds: int = 60,
        duration_minutes: Optional[int] = None
    ):
        """
        Collect snapshots continuously
        
        Args:
            interval_seconds: Time between collections
            duration_minutes: How long to run (None = forever)
        """
        start_time = time.time()
        count = 0
        
        logger.info(f"Starting continuous collection (interval: {interval_seconds}s)")
        
        try:
            while True:
                count += 1
                logger.info(f"[Collection #{count}]")
                
                self.collect_once()
                
                # Check duration
                if duration_minutes:
                    elapsed_minutes = (time.time() - start_time) / 60
                    if elapsed_minutes >= duration_minutes:
                        logger.info(f"Duration limit reached ({duration_minutes} min)")
                        break
                
                logger.info(f"Next collection in {interval_seconds}s...")
                time.sleep(interval_seconds)
                
        except KeyboardInterrupt:
            logger.info("Collection stopped by user")
        
        logger.info(f"Collected {count} rounds of snapshots")


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Allmight Snapshot Collector')
    parser.add_argument('--mode', choices=['once', 'continuous'], default='once')
    parser.add_argument('--interval', type=int, default=60, help='Seconds between collections')
    parser.add_argument('--duration', type=int, help='Minutes to run (continuous mode)')
    parser.add_argument('--data-dir', default='data/snapshots', help='Storage directory')
    
    args = parser.parse_args()
    
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Initialize
    storage = MarketStorage(args.data_dir)
    collector = SnapshotCollector(storage)
    
    if args.mode == 'once':
        snapshots = collector.collect_once()
        print(f"\nCollected {len(snapshots)} snapshots")
        
        # Print summary
        by_venue = {}
        for s in snapshots:
            venue = s.venue_id
            by_venue[venue] = by_venue.get(venue, 0) + 1
        
        print("\nBy venue:")
        for venue, count in by_venue.items():
            print(f"  {venue}: {count} markets")
    
    else:
        collector.collect_continuous(
            interval_seconds=args.interval,
            duration_minutes=args.duration
        )


if __name__ == '__main__':
    main()
