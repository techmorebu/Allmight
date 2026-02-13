#!/usr/bin/env python3
"""
Master Integration V4 - Advanced Multi-Strategy Arbitrage Detection

NEW in V4:
- Triangle arbitrage detection
- Multi-hop routing optimization
- Same-DEX fee tier arbitrage
- Stablecoin depeg arbitrage
- Cross-DEX arbitrage (enhanced)
- Bulletproof price validation
"""

import sys
import os
import time
import json
import redis
import logging
import argparse
from datetime import datetime
from typing import Dict, List, Optional, Tuple

# Add scripts directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load price validator
try:
    from price_validator import PriceValidator
    print("✅ Loaded PriceValidator")
except Exception as e:
    print(f"❌ Failed to load PriceValidator: {e}")
    sys.exit(1)

# Load advanced arbitrage detector
try:
    from advanced_arbitrage_detector import AdvancedArbDetector, ArbType, format_arb_opportunity
    print("✅ Loaded AdvancedArbDetector")
except Exception as e:
    print(f"❌ Failed to load AdvancedArbDetector: {e}")
    sys.exit(1)

# Load unified optimizer (for backward compatibility)
try:
    with open(os.path.join(os.path.dirname(__file__), 'unified_smart_optimizer.py'), 'r') as f:
        exec(f.read(), globals())
    print("✅ Loaded UnifiedSmartOptimizer")
except Exception as e:
    print(f"⚠️  UnifiedSmartOptimizer not available: {e}")

# Load Discord formatter V2
try:
    with open(os.path.join(os.path.dirname(__file__), 'discord_formatter_v2.py'), 'r') as f:
        formatter_code = f.read()
        exec(formatter_code, globals())
    print("✅ Loaded DiscordFormatterV2")
except Exception as e:
    print(f"⚠️  Discord formatter V2 not available: {e}")
    DiscordFormatterV2 = None
    send_to_discord = None

# Load env
try:
    from dotenv import load_dotenv
    load_dotenv()
except:
    pass

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('Allmight')


class AllmightScannerV4:
    """
    Enhanced scanner with multi-strategy arbitrage detection
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {
            'min_profit_usd': 10.0,
            'max_slippage_pct': 0.5,
            'max_pool_utilization': 0.01,
            'batch_size': 5,
            'enable_advanced_detection': True  # NEW: Enable all strategies
        }
        
        self.discord_formatter = DiscordFormatterV2() if DiscordFormatterV2 else None
        
        # Initialize price validator
        validator_config = {
            'eth_price_tolerance_bps': 200,
            'cross_dex_spread_max_bps': 500,
            'wbtc_eth_ratio_min': 20,
            'wbtc_eth_ratio_max': 50,
            'stablecoin_peg_tolerance_bps': 100,
            'min_major_pair_tvl': 1_000_000
        }
        self.validator = PriceValidator(validator_config)
        logger.info("✅ Initialized PriceValidator")
        
        # Initialize advanced arbitrage detector
        detector_config = {
            'min_profit_bps': 10,  # 0.1% minimum
            'max_hops': 4,
            'min_liquidity': 10_000
        }
        self.advanced_detector = AdvancedArbDetector(detector_config)
        logger.info("✅ Initialized AdvancedArbDetector (5 strategies)")
        
        # Discord settings
        self.discord_enabled = os.getenv('DISCORD_NOTIFICATIONS_ENABLED', 'false').lower() == 'true'
        
        # Redis
        redis_url = os.getenv('REDIS_URL', 'redis://127.0.0.1:6379')
        self.redis_client = redis.from_url(redis_url)
        self.redis_client.ping()
        logger.info(f"✅ Connected to Redis at {redis_url}")
        
        # Stats
        self.stats = {
            'total_scans': 0,
            'total_opportunities': 0,
            'total_viable': 0,
            'best_profit': 0,
            'validation_failures': 0,
            'strategies_used': {
                'cross_dex': 0,
                'triangle': 0,
                'multi_hop': 0,
                'same_dex': 0,
                'stablecoin': 0
            },
            'start_time': time.time()
        }
        
        # Price cache
        self.price_cache = {}
    
    def load_fetcher_data(self) -> Dict:
        """Load all fetcher data from Redis"""
        
        logger.info("📥 Loading fetcher data...")
        
        fetchers = ['uniswapV3Fetcher', 'sushiswapFetcher', 'curveFetcher', 'gasPriceOracle']
        data = {}
        
        for fetcher_name in fetchers:
            key = f'fetcher:{fetcher_name}'
            
            try:
                raw_data = self.redis_client.get(key)
                
                if raw_data:
                    parsed = json.loads(raw_data)
                    data[fetcher_name] = parsed
                    logger.info(f"  ✅ {fetcher_name.replace('Fetcher', '').capitalize()}")
                else:
                    logger.warning(f"  ⚠️  {fetcher_name}: No data")
                    
            except Exception as e:
                logger.error(f"  ❌ {fetcher_name}: {str(e)}")
        
        return data
    
    def extract_all_markets(self, data: Dict) -> Tuple[List[Dict], float]:
        """
        Extract ALL available markets from fetcher data
        """
        
        markets = []
        self.price_cache = {}
        
        # Get gas cost
        gas_data = data.get('gasPriceOracle', {})
        gas_cost = gas_data.get('data', {}).get('thresholds', {}).get('flashLoanTriangle', {}).get('fast', {}).get('gasCostUSD', 2.0)
        
        # === UNISWAP V3 ===
        uniswap_data = data.get('uniswapV3Fetcher', {}).get('data', {}).get('data', {})
        
        if 'prices' in uniswap_data:
            for price_data in uniswap_data['prices']:
                pair = price_data.get('pair', 'UNKNOWN')
                price = price_data.get('price', 0)
                
                self.price_cache[f'uniswap_{pair}'] = price
                
                markets.append({
                    'name': f"Uniswap {pair}",
                    'spread_bps': price_data.get('fee', 30) * 100 if 'fee' in price_data else 30,
                    'pool_liquidity': price_data.get('tvlUSD', 100_000_000),
                    'price': price,
                    'pool': price_data.get('pool', ''),
                    'source': 'uniswap'
                })
        
        # === SUSHISWAP ===
        sushiswap_data = data.get('sushiswapFetcher', {}).get('data', {}).get('data', {})
        
        if 'prices' in sushiswap_data:
            for price_data in sushiswap_data['prices']:
                pair = price_data.get('pair', 'UNKNOWN')
                price = price_data.get('price', 0)
                
                self.price_cache[f'sushiswap_{pair}'] = price
                
                markets.append({
                    'name': f"Sushiswap {pair}",
                    'spread_bps': 30,
                    'pool_liquidity': price_data.get('reserveUSD', 50_000_000),
                    'price': price,
                    'pool': price_data.get('pool', ''),
                    'source': 'sushiswap'
                })
        
        # === CURVE ===
        curve_data = data.get('curveFetcher', {}).get('data', {})
        
        if 'pools' in curve_data:
            for pool in curve_data['pools']:
                pool_name = pool.get('name', 'Unknown')
                
                if 'exchangeRates' in pool:
                    for rate in pool['exchangeRates']:
                        spread_from_peg = abs(1.0 - rate.get('rate', 1.0)) * 10000
                        
                        if spread_from_peg > 5:
                            markets.append({
                                'name': f"Curve {pool_name} {rate.get('from')}/{rate.get('to')}",
                                'spread_bps': spread_from_peg,
                                'pool_liquidity': pool.get('tvlUSD', 150_000_000),
                                'source': 'curve',
                                'price': rate.get('rate', 1.0)
                            })
        
        logger.info(f"📊 Extracted {len(markets)} markets total")
        
        return markets, gas_cost
    
    def scan_once(self) -> Dict:
        """Run single scan with advanced detection"""
        
        logger.info("=" * 70)
        logger.info("🔍 ALLMIGHT ADVANCED ARBITRAGE SCAN V4")
        logger.info("=" * 70)
        logger.info(f"Timestamp: {datetime.now().isoformat()}")
        
        # Load data
        data = self.load_fetcher_data()
        
        if not data:
            logger.error("❌ No fetcher data available")
            return None
        
        # ===== VALIDATION =====
        logger.info("🔍 Validating price data...")
        validation_result = self.validator.run_validation(data)
        
        if not validation_result['valid']:
            logger.error("=" * 70)
            logger.error("❌ VALIDATION FAILED - Aborting scan")
            logger.error("=" * 70)
            for error in validation_result['critical_errors']:
                logger.error(f"   ❌ {error}")
            
            self.stats['validation_failures'] += 1
            return None
        
        logger.info("✅ Price validation PASSED - Safe to proceed")
        
        # Extract markets
        markets, gas_cost = self.extract_all_markets(data)
        
        if not markets:
            logger.warning("⚠️  No markets extracted")
            return None
        
        # ===== ADVANCED DETECTION =====
        logger.info(f"🔎 Scanning {len(markets)} markets with AdvancedArbDetector...")
        logger.info(f"   Strategies: Cross-DEX, Triangle, Multi-hop, Same-DEX, Stablecoin")
        
        start_time = time.time()
        
        # Run advanced detection
        arb_paths = self.advanced_detector.find_all_arbitrage(markets, gas_cost)
        
        scan_time_ms = (time.time() - start_time) * 1000
        
        # Convert to results format
        results = self._format_results(arb_paths, scan_time_ms, gas_cost)
        
        # Update stats
        self.stats['total_scans'] += 1
        self.stats['total_opportunities'] += len(arb_paths)
        self.stats['total_viable'] += len([a for a in arb_paths if a.expected_profit_bps >= 50])
        
        # Track by strategy
        for arb in arb_paths:
            strategy_key = arb.path_type.value
            if strategy_key in self.stats['strategies_used']:
                self.stats['strategies_used'][strategy_key] += 1
        
        if arb_paths:
            best_profit_bps = max(a.expected_profit_bps for a in arb_paths)
            # Estimate USD (assuming $1000 trade)
            best_profit_usd = (best_profit_bps / 10000) * 1000
            self.stats['best_profit'] = max(self.stats['best_profit'], best_profit_usd)
        
        # Display results
        self._display_results(arb_paths, scan_time_ms)
        
        return results
    
    def _format_results(self, arb_paths: List, scan_time_ms: float, gas_cost: float) -> Dict:
        """Format arbitrage paths into results dict"""
        
        viable_paths = [a for a in arb_paths if a.expected_profit_bps >= 50]  # 0.5% minimum
        
        return {
            'arb_paths': arb_paths,
            'viable_paths': viable_paths,
            'scan_time_ms': scan_time_ms,
            'gas_cost': gas_cost,
            'summary_stats': {
                'total_scanned': len(arb_paths),
                'total_viable': len(viable_paths),
                'viable_rate': (len(viable_paths) / len(arb_paths) * 100) if arb_paths else 0,
                'best_profit_bps': max((a.expected_profit_bps for a in arb_paths), default=0),
                'strategies_found': {
                    'cross_dex': len([a for a in arb_paths if a.path_type == ArbType.CROSS_DEX]),
                    'triangle': len([a for a in arb_paths if a.path_type == ArbType.TRIANGLE]),
                    'multi_hop': len([a for a in arb_paths if a.path_type == ArbType.MULTI_HOP]),
                    'same_dex': len([a for a in arb_paths if a.path_type == ArbType.SAME_DEX_FEE]),
                    'stablecoin': len([a for a in arb_paths if a.path_type == ArbType.STABLECOIN_DEPEG])
                }
            }
        }
    
    def _display_results(self, arb_paths: List, scan_time_ms: float):
        """Display scan results"""
        
        logger.info("=" * 70)
        logger.info("📊 SCAN RESULTS")
        logger.info("=" * 70)
        
        logger.info(f"⏱️  Scan completed in {scan_time_ms:.2f}ms")
        logger.info(f"   Total opportunities: {len(arb_paths)}")
        
        if not arb_paths:
            logger.info("⚠️  No arbitrage opportunities found")
            logger.info(f"   This is normal - markets are efficient most of the time")
            return
        
        # Group by strategy
        by_strategy = {}
        for arb in arb_paths:
            strategy = arb.path_type.value
            if strategy not in by_strategy:
                by_strategy[strategy] = []
            by_strategy[strategy].append(arb)
        
        logger.info("")
        logger.info("📈 By Strategy:")
        for strategy, opps in by_strategy.items():
            avg_profit = sum(a.expected_profit_bps for a in opps) / len(opps)
            logger.info(f"   {strategy.upper()}: {len(opps)} opportunities (avg: {avg_profit:.1f} bps)")
        
        # Show top 10 opportunities
        sorted_paths = sorted(arb_paths, key=lambda x: x.expected_profit_bps, reverse=True)
        top_paths = sorted_paths[:10]
        
        logger.info("")
        logger.info("🏆 TOP 10 OPPORTUNITIES:")
        logger.info("")
        
        for i, arb in enumerate(top_paths, 1):
            tokens_path = " → ".join(arb.tokens)
            profit_pct = arb.expected_profit_bps / 100
            
            logger.info(f"   {i}. [{arb.path_type.value.upper()}] {tokens_path}")
            logger.info(f"      Profit: {arb.expected_profit_bps:.1f} bps ({profit_pct:.2f}%)")
            logger.info(f"      DEXs: {' → '.join(arb.dexs)}")
            logger.info(f"      Complexity: {arb.execution_complexity} swaps")
            logger.info("")
    
    def continuous_monitoring(self, interval_seconds: int = 30):
        """Continuous monitoring with advanced detection"""
        
        logger.info("=" * 70)
        logger.info("🔄 ALLMIGHT CONTINUOUS MONITORING V4")
        logger.info("=" * 70)
        logger.info(f"Scan interval: {interval_seconds} seconds")
        logger.info(f"Advanced detection: ENABLED (5 strategies)")
        logger.info(f"Discord: {'Enabled' if self.discord_enabled else 'Disabled'}")
        logger.info("Press Ctrl+C to stop")
        
        scan_count = 0
        
        try:
            while True:
                scan_count += 1
                logger.info(f"\n[Scan #{scan_count}]")
                
                results = self.scan_once()
                
                if results is None:
                    logger.warning("⚠️  Scan skipped")
                
                logger.info(f"⏳ Next scan in {interval_seconds} seconds...")
                time.sleep(interval_seconds)
                
        except KeyboardInterrupt:
            logger.info("\n\n⏹️  Stopped")
            self.print_session_summary()
    
    def print_session_summary(self):
        """Print session stats"""
        
        runtime = time.time() - self.stats['start_time']
        
        logger.info("=" * 70)
        logger.info("📊 SESSION SUMMARY")
        logger.info("=" * 70)
        logger.info(f"Runtime: {runtime/60:.1f} minutes")
        logger.info(f"Total scans: {self.stats['total_scans']}")
        logger.info(f"Validation failures: {self.stats['validation_failures']}")
        logger.info(f"Total opportunities: {self.stats['total_opportunities']}")
        logger.info(f"Viable opportunities: {self.stats['total_viable']}")
        logger.info(f"Best profit: ${self.stats['best_profit']:.2f}")
        
        logger.info("")
        logger.info("📈 Opportunities by Strategy:")
        for strategy, count in self.stats['strategies_used'].items():
            if count > 0:
                logger.info(f"   {strategy.upper()}: {count}")
        
        if self.stats['total_scans'] > 0:
            success_rate = ((self.stats['total_scans'] - self.stats['validation_failures']) / self.stats['total_scans']) * 100
            logger.info("")
            logger.info(f"✅ Validation success rate: {success_rate:.1f}%")


def main():
    parser = argparse.ArgumentParser(description='Allmight Scanner V4 - Advanced Multi-Strategy')
    parser.add_argument('--mode', choices=['scan-once', 'continuous'], default='scan-once')
    parser.add_argument('--interval', type=int, default=30)
    parser.add_argument('--min-profit', type=float, default=10.0)
    
    args = parser.parse_args()
    
    config = {
        'min_profit_usd': args.min_profit,
        'max_slippage_pct': 0.5,
        'max_pool_utilization': 0.01,
        'batch_size': 5,
        'enable_advanced_detection': True
    }
    
    scanner = AllmightScannerV4(config)
    
    if args.mode == 'scan-once':
        scanner.scan_once()
    else:
        scanner.continuous_monitoring(args.interval)
    
    scanner.print_session_summary()


if __name__ == '__main__':
    main()
