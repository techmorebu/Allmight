#!/usr/bin/env python3
"""
Master Integration - UPDATED with Unified Smart Optimizer
Uses the new unified_smart_optimizer for intelligent opportunity detection

This replaces the old master_integration_enhanced.py
"""

import sys
import os
import time
import json
import redis
import logging
import argparse
from datetime import datetime
from typing import Dict, List, Optional

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import the new unified optimizer
try:
    # Read and execute the unified optimizer as a module
    with open(os.path.join(os.path.dirname(__file__), 'unified_smart_optimizer.py'), 'r') as f:
        exec(f.read(), globals())
    print("✅ Loaded UnifiedSmartOptimizer")
except Exception as e:
    print(f"❌ Failed to load unified optimizer: {e}")
    print("Make sure unified_smart_optimizer.py is in the scripts/ directory")
    sys.exit(1)

# Import Discord formatter
try:
    with open(os.path.join(os.path.dirname(__file__), 'discord_formatter.py'), 'r') as f:
        exec(f.read(), globals())
    print("✅ Loaded DiscordFormatter")
except Exception as e:
    print(f"⚠️  Discord formatter not available: {e}")
    DiscordFormatter = None

# Load environment variables
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("⚠️  python-dotenv not installed, using environment variables only")


# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('Allmight')


class AllmightScanner:
    """
    Main scanner that uses UnifiedSmartOptimizer
    """
    
    def __init__(self, config: Optional[Dict] = None):
        """Initialize scanner with configuration"""
        
        self.config = config or {
            'min_profit_usd': 10.0,
            'max_slippage_pct': 0.5,
            'max_pool_utilization': 0.01,
            'batch_size': 5
        }
        
        # Initialize optimizer
        self.optimizer = UnifiedSmartOptimizer(self.config)
        
        # Initialize Discord formatter
        self.discord_formatter = DiscordFormatter() if DiscordFormatter else None
        
        # Discord webhooks
        self.alert_webhook = os.getenv('DISCORD_ALERT_WEBHOOK')
        self.detailed_webhook = os.getenv('DISCORD_DETAILED_WEBHOOK')
        self.discord_enabled = os.getenv('DISCORD_NOTIFICATIONS_ENABLED', 'false').lower() == 'true'
        
        # Redis connection
        redis_url = os.getenv('REDIS_URL', 'redis://127.0.0.1:6379')
        self.redis_client = redis.from_url(redis_url)
        
        # Test Redis
        self.redis_client.ping()
        logger.info(f"✅ Connected to Redis at {redis_url}")
        
        # Statistics
        self.stats = {
            'total_scans': 0,
            'total_opportunities': 0,
            'total_viable': 0,
            'best_profit': 0,
            'start_time': time.time()
        }
    
    def load_fetcher_data(self) -> Dict:
        """Load data from all fetchers in Redis"""
        
        logger.info("📥 Loading fetcher data...")
        
        fetchers = ['uniswapV3Fetcher', 'sushiswapFetcher', 'curveFetcher', 'gasPriceOracle']
        data = {}
        
        for fetcher_name in fetchers:
            key = f'fetcher:{fetcher_name}'
            
            try:
                raw_data = self.redis_client.get(key)
                
                if raw_data:
                    parsed = json.loads(raw_data)
                    # Unwrap nested data structure
                    data[fetcher_name] = parsed.get('data', parsed)
                    logger.info(f"  ✅ {fetcher_name.replace('Fetcher', '').replace('fetcher', '').title()}")
                else:
                    logger.warning(f"  ⚠️  {fetcher_name}: No data")
                    
            except Exception as e:
                logger.error(f"  ❌ {fetcher_name}: {str(e)}")
        
        return data
    
    def extract_markets_from_data(self, data: Dict) -> List[Dict]:
        """
        Extract market data into format expected by UnifiedSmartOptimizer
        
        Returns list of dicts with 'name', 'spread_bps', 'pool_liquidity'
        """
        
        markets = []
        
        # Get gas cost
        gas_data = data.get('gasPriceOracle', {})
        gas_cost = gas_data.get('data', {}).get('thresholds', {}).get('flashLoanTriangle', {}).get('fast', {}).get('gasCostUSD', 2.0)
        
        # Extract Uniswap pools
        uniswap_data = data.get('uniswapV3Fetcher', {}).get('data', {})
        if 'prices' in uniswap_data:
            for price_data in uniswap_data['prices']:
                markets.append({
                    'name': f"Uniswap {price_data.get('pair', 'UNKNOWN')}",
                    'spread_bps': 22,  # Using CoinGecko data, so spread is minimal
                    'pool_liquidity': price_data.get('tvlUSD', 100_000_000)
                })
        
        # Extract Sushiswap pools
        sushiswap_data = data.get('sushiswapFetcher', {}).get('data', {})
        if 'prices' in sushiswap_data:
            for price_data in sushiswap_data['prices']:
                markets.append({
                    'name': f"Sushiswap {price_data.get('pair', 'UNKNOWN')}",
                    'spread_bps': 25,  # Using CoinGecko data
                    'pool_liquidity': price_data.get('reserveUSD', 50_000_000)
                })
        
        # Extract Curve pools
        curve_data = data.get('curveFetcher', {}).get('data', {})
        if 'pools' in curve_data:
            for pool in curve_data['pools']:
                # Check for depegs in stablecoin pools
                if 'exchangeRates' in pool:
                    for rate in pool['exchangeRates']:
                        # Calculate spread from peg
                        spread_from_peg = abs(1.0 - rate.get('rate', 1.0)) * 10000
                        
                        if spread_from_peg > 10:  # More than 10 bps from peg
                            markets.append({
                                'name': f"Curve {rate.get('from')}/{rate.get('to')}",
                                'spread_bps': spread_from_peg,
                                'pool_liquidity': pool.get('tvlUSD', 150_000_000)
                            })
        
        return markets, gas_cost
    
    def send_discord_notifications(self, results: Dict):
        """Send Discord notifications for scan results"""
        
        if not self.discord_enabled or not self.discord_formatter:
            return
        
        try:
            import requests
            
            viable = results['viable_opportunities']
            stats = results['summary_stats']
            batches = results['execution_batches']
            
            # Send alert if there are viable opportunities
            if viable and self.alert_webhook:
                alert_msg = self.discord_formatter.create_alert_message(viable, stats, batch_size=3)
                
                payload = {'embeds': [alert_msg.embed]}
                response = requests.post(self.alert_webhook, json=payload, timeout=5)
                
                if response.status_code == 204:
                    logger.info(f"📱 Alert sent to Discord ({len(viable)} opportunities)")
            
            # Send detailed log
            if self.detailed_webhook:
                detailed_msg = self.discord_formatter.create_detailed_message(
                    results['all_opportunities'],
                    viable,
                    stats,
                    batches
                )
                
                payload = {'embeds': [detailed_msg.embed]}
                requests.post(self.detailed_webhook, json=payload, timeout=5)
                
        except Exception as e:
            logger.warning(f"Discord notification failed: {e}")
    
    def scan_once(self) -> Dict:
        """Run single scan"""
        
        logger.info("=" * 60)
        logger.info("🔍 ALLMIGHT ARBITRAGE SCAN")
        logger.info("=" * 60)
        logger.info(f"Timestamp: {datetime.now().isoformat()}")
        
        # Load data
        data = self.load_fetcher_data()
        
        if not data:
            logger.error("❌ No fetcher data available")
            return None
        
        # Extract markets
        markets, gas_cost = self.extract_markets_from_data(data)
        
        if not markets:
            logger.warning("⚠️  No markets extracted from fetcher data")
            return None
        
        logger.info(f"🔎 Scanning {len(markets)} markets with UnifiedSmartOptimizer...")
        
        # Scan with optimizer
        results = self.optimizer.scan_markets(markets, gas_cost)
        
        # Update stats
        self.stats['total_scans'] += 1
        self.stats['total_opportunities'] += len(results['all_opportunities'])
        self.stats['total_viable'] += len(results['viable_opportunities'])
        
        if results['viable_opportunities']:
            best = max(o.expected_profit for o in results['viable_opportunities'])
            self.stats['best_profit'] = max(self.stats['best_profit'], best)
        
        # Display results
        logger.info("=" * 60)
        logger.info("📊 SCAN RESULTS")
        logger.info("=" * 60)
        
        stats = results['summary_stats']
        
        logger.info(f"⏱️  Scan completed in {results['scan_time_ms']:.2f}ms")
        logger.info(f"   Total opportunities: {stats['total_scanned']}")
        logger.info(f"   Viable opportunities: {stats['total_viable']}")
        logger.info(f"   Viable rate: {stats['viable_rate']:.1f}%")
        
        if stats['total_viable'] > 0:
            logger.info(f"   Total profit: ${stats['total_profit']:.2f}")
            logger.info(f"   Avg profit: ${stats['avg_profit']:.2f}")
            logger.info(f"   Best profit: ${stats['best_profit']:.2f}")
            
            # Show top opportunities
            logger.info("")
            logger.info("🏆 TOP OPPORTUNITIES:")
            
            for i, opp in enumerate(results['viable_opportunities'][:5], 1):
                logger.info(f"   {i}. {opp.pool_name}: ${opp.expected_profit:.2f} profit ({opp.tier.value})")
        else:
            logger.info("⚠️  No viable opportunities found")
            logger.info(f"   Current settings: min profit ${self.config['min_profit_usd']}")
            logger.info(f"   Try again when market conditions improve")
        
        # Send Discord notifications
        self.send_discord_notifications(results)
        
        return results
    
    def continuous_monitoring(self, interval_seconds: int = 30):
        """Run continuous monitoring"""
        
        logger.info("=" * 60)
        logger.info("🔄 ALLMIGHT CONTINUOUS MONITORING")
        logger.info("=" * 60)
        logger.info(f"Scan interval: {interval_seconds} seconds")
        logger.info(f"Min profit: ${self.config['min_profit_usd']}")
        logger.info(f"Press Ctrl+C to stop")
        
        scan_count = 0
        
        try:
            while True:
                scan_count += 1
                
                logger.info(f"\n[Scan #{scan_count}]")
                
                # Run scan
                self.scan_once()
                
                # Wait for next scan
                logger.info(f"⏳ Next scan in {interval_seconds} seconds...")
                time.sleep(interval_seconds)
                
        except KeyboardInterrupt:
            logger.info("\n\n⏹️  Monitoring stopped by user")
            self.print_session_summary()
    
    def print_session_summary(self):
        """Print session statistics"""
        
        runtime = time.time() - self.stats['start_time']
        
        logger.info("=" * 60)
        logger.info("📊 SESSION SUMMARY")
        logger.info("=" * 60)
        logger.info(f"Runtime: {runtime/60:.1f} minutes")
        logger.info(f"Total scans: {self.stats['total_scans']}")
        logger.info(f"Total opportunities: {self.stats['total_opportunities']}")
        logger.info(f"Viable opportunities: {self.stats['total_viable']}")
        logger.info(f"Best profit seen: ${self.stats['best_profit']:.2f}")
        
        if self.stats['total_scans'] > 0:
            logger.info(f"Avg opportunities per scan: {self.stats['total_opportunities']/self.stats['total_scans']:.1f}")
            logger.info(f"Viable rate: {self.stats['total_viable']/self.stats['total_opportunities']*100:.1f}%" if self.stats['total_opportunities'] > 0 else "Viable rate: 0%")


def main():
    """Main entry point"""
    
    parser = argparse.ArgumentParser(description='Allmight Arbitrage Scanner with Unified Optimizer')
    parser.add_argument('--mode', choices=['scan-once', 'continuous', 'test'], default='scan-once',
                       help='Scan mode')
    parser.add_argument('--interval', type=int, default=30,
                       help='Scan interval in seconds (for continuous mode)')
    parser.add_argument('--min-profit', type=float, default=10.0,
                       help='Minimum profit threshold in USD')
    parser.add_argument('--debug', action='store_true',
                       help='Enable debug logging')
    
    args = parser.parse_args()
    
    if args.debug:
        logger.setLevel(logging.DEBUG)
    
    # Configuration
    config = {
        'min_profit_usd': args.min_profit,
        'max_slippage_pct': 0.5,
        'max_pool_utilization': 0.01,
        'batch_size': 5
    }
    
    # Initialize scanner
    scanner = AllmightScanner(config)
    
    # Run based on mode
    if args.mode == 'scan-once':
        scanner.scan_once()
    elif args.mode == 'continuous':
        scanner.continuous_monitoring(args.interval)
    elif args.mode == 'test':
        logger.info("🧪 TEST MODE - Using unified optimizer")
        logger.info("Configuration:")
        for key, value in config.items():
            logger.info(f"  {key}: {value}")
    
    scanner.print_session_summary()


if __name__ == '__main__':
    main()
