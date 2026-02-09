# master_integration_enhanced.py
# Enhanced version with Discord notifications
# Copy this to scripts/master_integration.py after reviewing

#!/usr/bin/env python3
"""
Allmight Phase 1 - Master Integration (Enhanced)
Complete arbitrage detection with Discord notifications and debugging.

Usage:
    python master_integration.py --mode scan-once
    python master_integration.py --mode continuous --interval 10  
    python master_integration.py --mode test
    python master_integration.py --mode test-discord
"""

import json
import time
import argparse
import sys
import os
import traceback
import logging
import subprocess
from datetime import datetime, timedelta
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

# Setup Python logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('Allmight')


class DiscordNotifier:
    """Python wrapper for Discord notifications"""
    
    def __init__(self):
        self.script_path = Path(__file__).parent.parent / 'utils' / 'discord_notifier.js'
        self.enabled = os.getenv('DISCORD_NOTIFICATIONS_ENABLED', 'true').lower() != 'false'
    
    def notify_opportunity(self, opportunity, stats):
        """Send opportunity notification via Node.js script"""
        if not self.enabled:
            return
        
        try:
            # Call Node.js script
            data = json.dumps({
                'type': 'opportunity',
                'opportunity': opportunity,
                'stats': stats
            })
            
            subprocess.run(
                ['node', '-e', self._get_notify_script('opportunity', data)],
                timeout=5,
                capture_output=True
            )
        except Exception as e:
            logger.warning(f"Failed to send Discord notification: {e}")
    
    def notify_error(self, error_msg, context):
        """Send error notification"""
        if not self.enabled:
            return
        
        try:
            data = json.dumps({
                'type': 'error',
                'message': error_msg,
                'context': context
            })
            
            subprocess.run(
                ['node', '-e', self._get_notify_script('error', data)],
                timeout=5,
                capture_output=True
            )
        except Exception as e:
            logger.warning(f"Failed to send error notification: {e}")
    
    def notify_status(self, status, stats):
        """Send status notification"""
        if not self.enabled:
            return
        
        try:
            data = json.dumps({
                'type': 'status',
                'status': status,
                'stats': stats
            })
            
            subprocess.run(
                ['node', '-e', self._get_notify_script('status', data)],
                timeout=5,
                capture_output=True
            )
        except Exception as e:
            logger.warning(f"Failed to send status notification: {e}")
    
    def _get_notify_script(self, notify_type, data):
        """Generate inline Node.js script for notification"""
        return f"""
const notifier = require('{self.script_path}');
const data = {data};
        
if (data.type === 'opportunity') {{
    notifier.notifyOpportunity(data.opportunity, data.stats);
}} else if (data.type === 'error') {{
    notifier.notifyError(
        new Error(data.message),
        data.context
    );
}} else if (data.type === 'status') {{
    notifier.notifyStatus(data.status, data.stats);
}}
"""


class AllmightIntegration:
    """
    Master integration with Discord notifications and debugging.
    """
    
    def __init__(self, redis_url: str = None):
        self.detector = OpportunityDetector(min_profit_usd=50.0)
        self.redis_url = redis_url or os.getenv('REDIS_URL', 'redis://127.0.0.1:6379')
        self.redis_client = None
        self.discord = DiscordNotifier()
        
        # Session tracking
        self.session_start = time.time()
        self.total_scans = 0
        self.total_opportunities = 0
        self.total_viable = 0
        self.best_profit = 0
        self.error_count = 0
        
        # Initialize Redis if available
        try:
            import redis
            self.redis_client = redis.from_url(self.redis_url)
            self.redis_client.ping()
            logger.info(f"✅ Connected to Redis at {self.redis_url}")
        except Exception as e:
            logger.warning(f"⚠️  Redis not available: {e}")
            logger.warning("   Will use file-based fallback")
            self.redis_client = None
    
    def load_fetcher_data(self, fetcher_name: str) -> dict:
        """Load data from a fetcher with detailed debugging."""
        
        logger.debug(f"Loading data for: {fetcher_name}")
        
        # Try Redis first
        if self.redis_client:
            try:
                key = f"fetcher:{fetcher_name}"
                data = self.redis_client.get(key)
                
                if data:
                    parsed = json.loads(data)
                    logger.debug(f"✅ Loaded {fetcher_name} from Redis ({len(data)} bytes)")
                    return parsed
                else:
                    logger.debug(f"⚠️  No Redis data for {fetcher_name}")
            except json.JSONDecodeError as e:
                logger.error(f"❌ Invalid JSON for {fetcher_name}: {e}")
            except Exception as e:
                logger.error(f"❌ Redis error loading {fetcher_name}: {e}")
        
        # Fallback: try to load from file
        file_path = Path(__file__).parent.parent / 'data' / f'{fetcher_name}.json'
        
        if file_path.exists():
            try:
                with open(file_path, 'r') as f:
                    data = json.load(f)
                logger.debug(f"✅ Loaded {fetcher_name} from file")
                return data
            except Exception as e:
                logger.error(f"❌ File error loading {fetcher_name}: {e}")
        else:
            logger.debug(f"⚠️  No file found: {file_path}")
        
        return None
    
    def run_scan_once(self) -> dict:
        """Run a single scan with comprehensive error tracking."""
        
        logger.info("="*60)
        logger.info("🔍 ALLMIGHT ARBITRAGE SCAN")
        logger.info("="*60)
        logger.info(f"Timestamp: {datetime.utcnow().isoformat()}")
        
        self.total_scans += 1
        
        try:
            # Load all fetcher data
            logger.info("📥 Loading fetcher data...")
            
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
                logger.info(f"  {status} {name}")
            
            # Data validation
            available_dexs = sum([
                1 if uniswap_data and uniswap_data.get('status') == 'success' else 0,
                1 if sushiswap_data and sushiswap_data.get('status') == 'success' else 0,
                1 if curve_data and curve_data.get('status') == 'success' else 0
            ])
            
            if available_dexs < 2:
                error_msg = "Insufficient DEX data (need at least 2)"
                logger.error(f"❌ {error_msg}")
                self.discord.notify_error(error_msg, {
                    'component': 'DataLoader',
                    'data_status': data_status
                })
                return {
                    'status': 'error',
                    'error': error_msg,
                    'data_status': data_status
                }
            
            if not gas_data or gas_data.get('status') != 'success':
                error_msg = "Gas oracle data unavailable"
                logger.error(f"❌ {error_msg}")
                self.discord.notify_error(error_msg, {
                    'component': 'GasOracle'
                })
                return {
                    'status': 'error',
                    'error': error_msg
                }
            
            logger.info("🔎 Running opportunity detection...")
            
            # Run the scan
            result = self.detector.scan_all(
                uniswap_data or {},
                sushiswap_data or {},
                curve_data or {},
                gas_data
            )
            
            # Update stats
            if result.get('status') == 'success':
                stats = result['stats']
                self.total_opportunities += stats['total_found']
                self.total_viable += stats['viable_count']
                
                if stats.get('best_profit_usd', 0) > self.best_profit:
                    self.best_profit = stats['best_profit_usd']
            
            # Display results
            self._display_results(result)
            
            # Send Discord notification if viable opportunity found
            if result.get('status') == 'success' and result.get('top_opportunity'):
                self.discord.notify_opportunity(
                    result['top_opportunity'],
                    {
                        'total_scans': self.total_scans,
                        'viable_percentage': result['stats'].get('viable_percentage', 0)
                    }
                )
            
            return result
            
        except Exception as e:
            self.error_count += 1
            error_msg = f"Scan failed with exception: {str(e)}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            
            self.discord.notify_error(error_msg, {
                'component': 'ScanEngine',
                'exception_type': type(e).__name__,
                'traceback': traceback.format_exc()
            })
            
            return {
                'status': 'error',
                'error': error_msg,
                'exception': str(e)
            }
    
    def run_continuous(self, interval_seconds: int = 10):
        """Run continuous scanning with status updates."""
        
        logger.info("="*60)
        logger.info("🔄 ALLMIGHT CONTINUOUS MONITORING")
        logger.info("="*60)
        logger.info(f"Scan interval: {interval_seconds} seconds")
        logger.info("Press Ctrl+C to stop")
        
        # Send startup notification
        self.discord.notify_status('started', {
            'interval_seconds': interval_seconds,
            'min_profit_usd': self.detector.min_profit_usd
        })
        
        try:
            while True:
                logger.info(f"\n[Scan #{self.total_scans + 1}]")
                
                result = self.run_scan_once()
                
                if result.get('status') == 'success':
                    viable = result['stats']['viable_count']
                    
                    if viable > 0:
                        logger.info(f"🎯 {viable} viable opportunity(ies) found!")
                        self._log_opportunity(result['top_opportunity'])
                
                # Send hourly status update
                uptime = time.time() - self.session_start
                if uptime > 0 and int(uptime) % 3600 < interval_seconds:
                    self._send_status_update()
                
                logger.info(f"⏳ Next scan in {interval_seconds} seconds...")
                time.sleep(interval_seconds)
                
        except KeyboardInterrupt:
            logger.info("\n\n" + "="*60)
            logger.info("📊 SESSION SUMMARY")
            logger.info("="*60)
            
            self._display_session_summary()
            
            # Send shutdown notification
            self.discord.notify_status('stopped', self._get_session_stats())
            
            logger.info("\n✅ Monitoring stopped")
    
    def run_test(self):
        """Run with test/mock data."""
        
        logger.info("="*60)
        logger.info("🧪 ALLMIGHT TEST MODE")
        logger.info("="*60)
        logger.info("Using mock data for testing\n")
        
        # Create mock data
        mock_data = self._create_mock_data()
        
        result = self.detector.scan_all(
            mock_data['uniswap'],
            mock_data['sushiswap'],
            mock_data['curve'],
            mock_data['gas']
        )
        
        self._display_results(result)
        
        logger.info("="*60)
        logger.info("💡 This was TEST MODE")
        logger.info("   For real scanning, run fetchers first:")
        logger.info("   node scripts/master-fetcher.js once")
        logger.info("="*60)
    
    def test_discord(self):
        """Test Discord notifications."""
        
        logger.info("="*60)
        logger.info("🧪 TESTING DISCORD NOTIFICATIONS")
        logger.info("="*60)
        
        # Test opportunity notification
        logger.info("\n1. Testing opportunity notification...")
        self.discord.notify_opportunity(
            {
                'type': 'cross_dex',
                'strategy': 'Buy Uniswap → Sell Sushiswap',
                'pair': 'ETH/USDC',
                'buy_exchange': 'uniswap_v3',
                'sell_exchange': 'sushiswap',
                'profit': {
                    'net_usd': 127.50,
                    'net_bps': 42.5,
                    'gross_usd': 145.30,
                    'gas_cost_usd': 17.80
                },
                'recommended_trade_size': {
                    'recommended_usd': 10000
                }
            },
            {
                'total_scans': 42,
                'viable_percentage': 12.5
            }
        )
        
        # Test error notification
        logger.info("2. Testing error notification...")
        self.discord.notify_error(
            "This is a test error from Allmight",
            {
                'component': 'DiscordTest',
                'severity': 'test'
            }
        )
        
        # Test status notification
        logger.info("3. Testing status notification...")
        self.discord.notify_status('healthy', {
            'uptime': 3600,
            'total_scans': 360,
            'opportunities_found': 45,
            'network_state': 'normal',
            'gas_price': 25.5
        })
        
        logger.info("\n✅ Test notifications sent!")
        logger.info("   Check your Discord channel(s)")
        logger.info("="*60)
    
    def _display_results(self, result: dict):
        """Pretty-print scan results with detailed logging."""
        
        if result.get('status') != 'success':
            logger.error(f"❌ Scan failed: {result.get('error', 'Unknown error')}")
            return
        
        stats = result['stats']
        
        logger.info("="*60)
        logger.info("📊 SCAN RESULTS")
        logger.info("="*60)
        
        logger.info(f"⏱️  Scan completed in {result['scan_duration_ms']}ms")
        logger.info(f"   Total opportunities: {stats['total_found']}")
        logger.info(f"   Viable opportunities: {stats['viable_count']}")
        logger.info(f"   Viable rate: {stats['viable_percentage']}%")
        
        # Breakdown by type
        by_type = result['opportunities']['by_type']
        logger.info(f"📈 By Type:")
        logger.info(f"   Cross-DEX: {by_type['cross_dex']}")
        logger.info(f"   Triangle: {by_type['triangle']}")
        logger.info(f"   Stablecoin: {by_type['stablecoin']}")
        
        # Network state
        network = result.get('network_state', {})
        logger.info(f"🌐 Network:")
        logger.info(f"   Congestion: {network.get('congestion', 'unknown').upper()}")
        logger.info(f"   Flash loans viable: {'YES ✅' if network.get('flashLoanViable') else 'NO ❌'}")
        logger.info(f"   Gas cost: ${result.get('gas_cost_usd', 0):.2f}")
        
        # Top opportunity
        if result.get('top_opportunity'):
            logger.info("="*60)
            logger.info("🏆 BEST OPPORTUNITY")
            logger.info("="*60)
            
            top = result['top_opportunity']
            logger.info(f"Type: {top['type'].upper()}")
            logger.info(f"Strategy: {top['strategy']}")
            logger.info(f"Pair: {top.get('pair', 'N/A')}")
            
            profit = top['profit']
            logger.info(f"Profit:")
            logger.info(f"  Gross: ${profit['gross_usd']:.2f} ({profit['gross_bps']:.2f} bps)")
            logger.info(f"  Gas cost: ${profit['gas_cost_usd']:.2f}")
            logger.info(f"  Net: ${profit['net_usd']:.2f} ({profit['net_bps']:.2f} bps)")
            
            if 'fees' in top:
                fees = top['fees']
                logger.info(f"Fees:")
                logger.info(f"  Total: {fees['total_fee_bps']:.2f} bps (${fees.get('fee_cost_usd', 0):.2f})")
            
            if 'recommended_trade_size' in top:
                size = top['recommended_trade_size']
                logger.info(f"Recommended size:")
                logger.info(f"  Min: ${size.get('min_size_usd', 0):.2f}")
                logger.info(f"  Optimal: ${size.get('recommended_usd', 0):.2f}")
        else:
            logger.info("⚠️  No viable opportunities found")
            logger.info("   Try again when network conditions improve")
    
    def _display_session_summary(self):
        """Display session statistics."""
        
        uptime = time.time() - self.session_start
        
        logger.info(f"Total scans: {self.total_scans}")
        logger.info(f"Total opportunities: {self.total_opportunities}")
        logger.info(f"Viable opportunities: {self.total_viable}")
        logger.info(f"Best profit seen: ${self.best_profit:.2f}")
        logger.info(f"Errors encountered: {self.error_count}")
        logger.info(f"Uptime: {self._format_uptime(uptime)}")
        
        if self.total_scans > 0:
            logger.info(f"Average opportunities/scan: {self.total_opportunities / self.total_scans:.2f}")
            logger.info(f"Viable rate: {(self.total_viable / self.total_opportunities * 100):.2f}%" if self.total_opportunities > 0 else "0%")
    
    def _send_status_update(self):
        """Send hourly status update to Discord."""
        
        self.discord.notify_status('healthy', self._get_session_stats())
    
    def _get_session_stats(self):
        """Get current session statistics."""
        
        uptime = time.time() - self.session_start
        
        return {
            'uptime': int(uptime),
            'total_scans': self.total_scans,
            'opportunities_found': self.total_opportunities,
            'viable_opportunities': self.total_viable,
            'best_profit_usd': self.best_profit,
            'error_count': self.error_count
        }
    
    def _log_opportunity(self, opportunity: dict):
        """Log an opportunity to file for audit trail."""
        
        log_dir = Path(__file__).parent.parent / 'logs' / 'opportunities'
        log_dir.mkdir(parents=True, exist_ok=True)
        
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        log_file = log_dir / f'opportunity_{timestamp}.json'
        
        try:
            with open(log_file, 'w') as f:
                json.dump(opportunity, f, indent=2)
            
            logger.info(f"   📝 Logged to: {log_file}")
        except Exception as e:
            logger.warning(f"   ⚠️  Could not log opportunity: {e}")
    
    def _format_uptime(self, seconds):
        """Format uptime in human-readable format."""
        
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        
        if hours > 0:
            return f"{hours}h {minutes}m {secs}s"
        elif minutes > 0:
            return f"{minutes}m {secs}s"
        else:
            return f"{secs}s"
    
    def _create_mock_data(self) -> dict:
        """Create mock data for testing (same as before)."""
        
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
        description='Allmight Phase 1 - Arbitrage Detection System (Enhanced)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Run a single scan
  python master_integration.py --mode scan-once
  
  # Continuous monitoring (every 10 seconds)
  python master_integration.py --mode continuous --interval 10
  
  # Test mode with mock data
  python master_integration.py --mode test
  
  # Test Discord notifications
  python master_integration.py --mode test-discord
        """
    )
    
    parser.add_argument(
        '--mode',
        choices=['scan-once', 'continuous', 'test', 'test-discord'],
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
    
    parser.add_argument(
        '--debug',
        action='store_true',
        help='Enable debug logging'
    )
    
    args = parser.parse_args()
    
    # Set log level
    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)
        logger.setLevel(logging.DEBUG)
    
    # Initialize integration
    integration = AllmightIntegration(redis_url=args.redis_url)
    
    # Run selected mode
    if args.mode == 'scan-once':
        integration.run_scan_once()
    
    elif args.mode == 'continuous':
        integration.run_continuous(interval_seconds=args.interval)
    
    elif args.mode == 'test':
        integration.run_test()
    
    elif args.mode == 'test-discord':
        integration.test_discord()


if __name__ == '__main__':
    main()
