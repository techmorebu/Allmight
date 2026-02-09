#!/usr/bin/env python3
"""
Allmight Phase 1 - Master Integration Script
Runs the complete arbitrage detection system.

Usage:
    python master_integration.py --mode scan-once
    python master_integration.py --mode continuous --interval 10
    python master_integration.py --mode test
"""

import json
import time
import argparse
import sys
import os
from datetime import datetime
from pathlib import Path

# Add src to path
sys.path.append(str(Path(__file__).parent.parent))

try:
    from src.arbitrage.opportunity_detector import OpportunityDetector
    from src.arbitrage.spread_calculator import SpreadCalculator
except ImportError:
    print("⚠️  Could not import modules. Make sure you're running from project root.")
    print("   Usage: python scripts/master_integration.py")
    sys.exit(1)


class AllmightIntegration:
    """
    Master integration for Phase 1 arbitrage detection.
    
    Workflow:
    1. Load data from all fetchers (from Redis or files)
    2. Pass to opportunity detector
    3. Rank and filter opportunities
    4. Log results
    5. (Future: Execute trades)
    """
    
    def __init__(self, redis_url: str = None):
        self.detector = OpportunityDetector(min_profit_usd=50.0)
        self.redis_url = redis_url or os.getenv('REDIS_URL', 'redis://127.0.0.1:6379')
        self.redis_client = None
        
        # Initialize Redis if available
        try:
            import redis
            self.redis_client = redis.from_url(self.redis_url)
            self.redis_client.ping()
            print(f"✅ Connected to Redis at {self.redis_url}")
        except Exception as e:
            print(f"⚠️  Redis not available: {e}")
            print("   Will use file-based fallback")
            self.redis_client = None
    
    def load_fetcher_data(self, fetcher_name: str) -> dict:
        """Load data from a fetcher (Redis or file fallback)."""
        
        # Try Redis first
        if self.redis_client:
            try:
                key = f"fetcher:{fetcher_name}"
                data = self.redis_client.get(key)
                
                if data:
                    return json.loads(data)
                else:
                    print(f"⚠️  No data in Redis for {fetcher_name}")
            except Exception as e:
                print(f"⚠️  Redis error loading {fetcher_name}: {e}")
        
        # Fallback: try to load from file
        file_path = Path(__file__).parent.parent / 'data' / f'{fetcher_name}.json'
        
        if file_path.exists():
            try:
                with open(file_path, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"⚠️  File error loading {fetcher_name}: {e}")
        
        return None
    
    def run_scan_once(self) -> dict:
        """Run a single scan of all data sources."""
        
        print("\n" + "="*60)
        print("🔍 ALLMIGHT ARBITRAGE SCAN")
        print("="*60)
        print(f"Timestamp: {datetime.utcnow().isoformat()}")
        print()
        
        # Load all fetcher data
        print("📥 Loading fetcher data...")
        
        uniswap_data = self.load_fetcher_data('uniswapV3Fetcher')
        sushiswap_data = self.load_fetcher_data('sushiswapFetcher')
        curve_data = self.load_fetcher_data('curveFetcher')
        gas_data = self.load_fetcher_data('gasPriceOracle')
        
        # Check what we got
        data_status = {
            'Uniswap V3': '✅' if uniswap_data else '❌',
            'Sushiswap': '✅' if sushiswap_data else '❌',
            'Curve': '✅' if curve_data else '❌',
            'Gas Oracle': '✅' if gas_data else '❌'
        }
        
        for name, status in data_status.items():
            print(f"  {status} {name}")
        
        # Need at least 2 DEXs and gas data
        available_dexs = sum([
            1 if uniswap_data else 0,
            1 if sushiswap_data else 0,
            1 if curve_data else 0
        ])
        
        if available_dexs < 2 or not gas_data:
            print("\n❌ Insufficient data for scanning")
            print("   Need: At least 2 DEXs + Gas Oracle")
            return {
                'status': 'error',
                'error': 'Insufficient data',
                'data_status': data_status
            }
        
        print("\n🔎 Running opportunity detection...")
        
        # Run the scan
        result = self.detector.scan_all(
            uniswap_data or {},
            sushiswap_data or {},
            curve_data or {},
            gas_data
        )
        
        # Display results
        self._display_results(result)
        
        return result
    
    def run_continuous(self, interval_seconds: int = 10):
        """Run continuous scanning at specified interval."""
        
        print("\n" + "="*60)
        print("🔄 ALLMIGHT CONTINUOUS MONITORING")
        print("="*60)
        print(f"Scan interval: {interval_seconds} seconds")
        print("Press Ctrl+C to stop")
        print()
        
        scan_count = 0
        total_opportunities = 0
        
        try:
            while True:
                scan_count += 1
                print(f"\n[Scan #{scan_count}]")
                
                result = self.run_scan_once()
                
                if result.get('status') == 'success':
                    viable = result['stats']['viable_count']
                    total_opportunities += viable
                    
                    if viable > 0:
                        print(f"\n🎯 {viable} viable opportunity(ies) found!")
                        self._log_opportunity(result['top_opportunity'])
                
                print(f"\n⏳ Next scan in {interval_seconds} seconds...")
                time.sleep(interval_seconds)
                
        except KeyboardInterrupt:
            print("\n\n" + "="*60)
            print("📊 SESSION SUMMARY")
            print("="*60)
            print(f"Total scans: {scan_count}")
            print(f"Total viable opportunities: {total_opportunities}")
            print(f"Average per scan: {total_opportunities / scan_count:.2f}")
            print("\n✅ Monitoring stopped")
    
    def run_test(self):
        """Run with test/mock data."""
        
        print("\n" + "="*60)
        print("🧪 ALLMIGHT TEST MODE")
        print("="*60)
        print("Using mock data for testing\n")
        
        # Create mock data
        mock_data = self._create_mock_data()
        
        result = self.detector.scan_all(
            mock_data['uniswap'],
            mock_data['sushiswap'],
            mock_data['curve'],
            mock_data['gas']
        )
        
        self._display_results(result)
        
        print("\n" + "="*60)
        print("💡 This was TEST MODE")
        print("   For real scanning, run fetchers first:")
        print("   node scripts/master-fetcher.js once")
        print("="*60)
    
    def _display_results(self, result: dict):
        """Pretty-print scan results."""
        
        if result.get('status') != 'success':
            print(f"\n❌ Scan failed: {result.get('error', 'Unknown error')}")
            return
        
        stats = result['stats']
        
        print("\n" + "="*60)
        print("📊 SCAN RESULTS")
        print("="*60)
        
        print(f"\n⏱️  Scan completed in {result['scan_duration_ms']}ms")
        print(f"   Total opportunities: {stats['total_found']}")
        print(f"   Viable opportunities: {stats['viable_count']}")
        print(f"   Viable rate: {stats['viable_percentage']}%")
        
        # Breakdown by type
        by_type = result['opportunities']['by_type']
        print(f"\n📈 By Type:")
        print(f"   Cross-DEX: {by_type['cross_dex']}")
        print(f"   Triangle: {by_type['triangle']}")
        print(f"   Stablecoin: {by_type['stablecoin']}")
        
        # Network state
        network = result.get('network_state', {})
        print(f"\n🌐 Network:")
        print(f"   Congestion: {network.get('congestion', 'unknown').upper()}")
        print(f"   Flash loans viable: {'YES ✅' if network.get('flashLoanViable') else 'NO ❌'}")
        print(f"   Gas cost: ${result.get('gas_cost_usd', 0):.2f}")
        
        # Top opportunity
        if result.get('top_opportunity'):
            print("\n" + "="*60)
            print("🏆 BEST OPPORTUNITY")
            print("="*60)
            
            top = result['top_opportunity']
            print(f"\nType: {top['type'].upper()}")
            print(f"Strategy: {top['strategy']}")
            print(f"Pair: {top.get('pair', 'N/A')}")
            
            profit = top['profit']
            print(f"\nProfit:")
            print(f"  Gross: ${profit['gross_usd']:.2f} ({profit['gross_bps']:.2f} bps)")
            print(f"  Gas cost: ${profit['gas_cost_usd']:.2f}")
            print(f"  Net: ${profit['net_usd']:.2f} ({profit['net_bps']:.2f} bps)")
            
            if 'fees' in top:
                fees = top['fees']
                print(f"\nFees:")
                print(f"  Total: {fees['total_fee_bps']:.2f} bps (${fees.get('fee_cost_usd', 0):.2f})")
            
            if 'recommended_trade_size' in top:
                size = top['recommended_trade_size']
                print(f"\nRecommended size:")
                print(f"  Min: ${size.get('min_size_usd', 0):.2f}")
                print(f"  Optimal: ${size.get('recommended_usd', 0):.2f}")
        else:
            print("\n⚠️  No viable opportunities found")
            print("   Try again when network conditions improve")
    
    def _log_opportunity(self, opportunity: dict):
        """Log an opportunity to file for audit trail."""
        
        log_dir = Path(__file__).parent.parent / 'logs' / 'opportunities'
        log_dir.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        log_file = log_dir / f'opportunity_{timestamp}.json'
        
        try:
            with open(log_file, 'w') as f:
                json.dump(opportunity, f, indent=2)
            
            print(f"   📝 Logged to: {log_file}")
        except Exception as e:
            print(f"   ⚠️  Could not log opportunity: {e}")
    
    def _create_mock_data(self) -> dict:
        """Create mock data for testing."""
        
        return {
            'uniswap': {
                'status': 'success',
                'data': {
                    'prices': [
                        {'pair': 'ETH/USDC', 'price': 2400.50, 'liquidity': 100000000},
                        {'pair': 'ETH/DAI', 'price': 2401.00, 'liquidity': 50000000}
                    ],
                    'pools': [
                        {
                            'id': '0x123',
                            'pair': 'ETH/USDC',
                            'token0': {'symbol': 'ETH'},
                            'token1': {'symbol': 'USDC'},
                            'token0Price': 2400.50,
                            'feeTier': 3000,
                            'tvlUSD': 100000000
                        }
                    ]
                }
            },
            'sushiswap': {
                'status': 'success',
                'data': {
                    'prices': [
                        {'pair': 'ETH/USDC', 'price': 2410.00, 'liquidity': 50000000}
                    ]
                }
            },
            'curve': {
                'status': 'success',
                'data': {
                    'opportunities': [
                        {
                            'coin': 'USDC',
                            'actualPrice': 0.9985,
                            'arbitrageType': 'BUY',
                            'pool': '3pool'
                        }
                    ]
                }
            },
            'gas': {
                'status': 'success',
                'data': {
                    'thresholds': {
                        'simpleSwap': {'fast': {'gasCostUSD': 15.0}},
                        'flashLoanTriangle': {'fast': {'gasCostUSD': 35.0}}
                    },
                    'networkState': {
                        'congestion': 'normal',
                        'flashLoanViable': True
                    }
                }
            }
        }


def main():
    parser = argparse.ArgumentParser(
        description='Allmight Phase 1 - Arbitrage Detection System',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run a single scan
  python master_integration.py --mode scan-once
  
  # Continuous monitoring (every 10 seconds)
  python master_integration.py --mode continuous --interval 10
  
  # Test mode with mock data
  python master_integration.py --mode test
        """
    )
    
    parser.add_argument(
        '--mode',
        choices=['scan-once', 'continuous', 'test'],
        default='scan-once',
        help='Execution mode'
    )
    
    parser.add_argument(
        '--interval',
        type=int,
        default=10,
        help='Scan interval in seconds (for continuous mode)'
    )
    
    parser.add_argument(
        '--redis-url',
        type=str,
        default=None,
        help='Redis URL (default: from .env or redis://127.0.0.1:6379)'
    )
    
    args = parser.parse_args()
    
    # Initialize integration
    integration = AllmightIntegration(redis_url=args.redis_url)
    
    # Run selected mode
    if args.mode == 'scan-once':
        integration.run_scan_once()
    
    elif args.mode == 'continuous':
        integration.run_continuous(interval_seconds=args.interval)
    
    elif args.mode == 'test':
        integration.run_test()


if __name__ == '__main__':
    main()
