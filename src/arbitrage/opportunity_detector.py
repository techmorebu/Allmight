// src/arbitrage/opportunity_detector.py
"""
Opportunity Detector - Phase 1
Scans all DEX data and detects profitable arbitrage opportunities.
Integrates: DEX fetchers + Gas Oracle + Spread Calculator
"""

import json
import time
from typing import Dict, List, Optional
from datetime import datetime
import os
import sys

# Import the spread calculator
sys.path.append(os.path.dirname(__file__))
from spread_calculator import SpreadCalculator


class OpportunityDetector:
    """
    Core arbitrage opportunity detection engine.
    
    Monitors:
    - Cross-DEX spreads (Uniswap vs Sushiswap)
    - Triangle arbitrage (same DEX)
    - Stablecoin depegs (Curve)
    
    Outputs: Ranked list of profitable opportunities
    """
    
    def __init__(self, min_profit_usd: float = 50.0, min_profit_bps: int = 20):
        """
        Initialize detector.
        
        Args:
            min_profit_usd: Minimum profit in USD to consider viable
            min_profit_bps: Minimum profit in basis points (0.2% = 20 bps)
        """
        self.spread_calc = SpreadCalculator()
        self.min_profit_usd = min_profit_usd
        self.min_profit_bps = min_profit_bps
        
        # Tracking
        self.opportunities_found = 0
        self.opportunities_viable = 0
        self.last_scan_time = None
        
        # Target trading pairs (most liquid)
        self.target_pairs = [
            'ETH/USDC',
            'ETH/DAI',
            'USDC/DAI',
            'WBTC/ETH',
            'WBTC/USDC'
        ]
        
        # Triangle arbitrage paths to monitor
        self.triangle_paths = [
            ['ETH', 'USDC', 'DAI', 'ETH'],
            ['ETH', 'USDC', 'WBTC', 'ETH'],
            ['USDC', 'DAI', 'ETH', 'USDC'],
        ]
    
    def scan_all(
        self,
        uniswap_data: Dict,
        sushiswap_data: Dict,
        curve_data: Dict,
        gas_data: Dict
    ) -> Dict:
        """
        Scan all available data for opportunities.
        
        Args:
            uniswap_data: Data from Uniswap V3 fetcher
            sushiswap_data: Data from Sushiswap fetcher
            curve_data: Data from Curve fetcher
            gas_data: Data from gas price oracle
            
        Returns:
            Dict with all detected opportunities, ranked by profit
        """
        
        scan_start = time.time()
        self.last_scan_time = datetime.utcnow().isoformat()
        
        opportunities = {
            'cross_dex': [],
            'triangle': [],
            'stablecoin': []
        }
        
        # Extract gas cost for flash loans (fast speed)
        gas_cost = self._extract_gas_cost(gas_data, 'flashLoanTriangle')
        
        if gas_cost is None:
            return {
                'status': 'error',
                'error': 'Could not determine gas cost',
                'timestamp': self.last_scan_time
            }
        
        # 1. Scan for cross-DEX arbitrage
        if self._validate_data(uniswap_data) and self._validate_data(sushiswap_data):
            cross_dex_opps = self._scan_cross_dex(
                uniswap_data,
                sushiswap_data,
                gas_cost
            )
            opportunities['cross_dex'] = cross_dex_opps
        
        # 2. Scan for triangle arbitrage (Uniswap)
        if self._validate_data(uniswap_data):
            triangle_opps = self._scan_triangle(
                uniswap_data,
                gas_cost
            )
            opportunities['triangle'] = triangle_opps
        
        # 3. Scan for stablecoin depeg (Curve)
        if self._validate_data(curve_data):
            stablecoin_opps = self._scan_stablecoin(
                curve_data,
                self._extract_gas_cost(gas_data, 'simpleSwap')
            )
            opportunities['stablecoin'] = stablecoin_opps
        
        # Combine and rank all opportunities
        all_opportunities = (
            opportunities['cross_dex'] +
            opportunities['triangle'] +
            opportunities['stablecoin']
        )
        
        # Filter viable opportunities
        viable_opportunities = [
            opp for opp in all_opportunities
            if opp.get('viable', False) and opp.get('profit', {}).get('net_usd', 0) > self.min_profit_usd
        ]
        
        # Sort by net profit (descending)
        viable_opportunities.sort(
            key=lambda x: x.get('profit', {}).get('net_usd', 0),
            reverse=True
        )
        
        # Update stats
        self.opportunities_found += len(all_opportunities)
        self.opportunities_viable += len(viable_opportunities)
        
        scan_duration = (time.time() - scan_start) * 1000  # ms
        
        return {
            'status': 'success',
            'timestamp': self.last_scan_time,
            'scan_duration_ms': round(scan_duration, 2),
            'opportunities': {
                'all': all_opportunities,
                'viable': viable_opportunities,
                'by_type': {
                    'cross_dex': len(opportunities['cross_dex']),
                    'triangle': len(opportunities['triangle']),
                    'stablecoin': len(opportunities['stablecoin'])
                }
            },
            'top_opportunity': viable_opportunities[0] if viable_opportunities else None,
            'stats': {
                'total_found': len(all_opportunities),
                'viable_count': len(viable_opportunities),
                'viable_percentage': round((len(viable_opportunities) / len(all_opportunities) * 100), 2) if all_opportunities else 0,
                'best_profit_usd': viable_opportunities[0].get('profit', {}).get('net_usd', 0) if viable_opportunities else 0
            },
            'gas_cost_usd': gas_cost,
            'network_state': gas_data.get('data', {}).get('networkState', {})
        }
    
    def _scan_cross_dex(
        self,
        uniswap_data: Dict,
        sushiswap_data: Dict,
        gas_cost: float
    ) -> List[Dict]:
        """Scan for cross-DEX arbitrage opportunities."""
        
        opportunities = []
        
        for pair in self.target_pairs:
            try:
                # Get data from both exchanges
                uni_exchange = {
                    'exchange': 'uniswap_v3',
                    'prices': uniswap_data.get('data', {}).get('prices', []),
                    'liquidity': self._get_liquidity(uniswap_data, pair)
                }
                
                sushi_exchange = {
                    'exchange': 'sushiswap',
                    'prices': sushiswap_data.get('data', {}).get('prices', []),
                    'liquidity': self._get_liquidity(sushiswap_data, pair)
                }
                
                # Calculate spread
                result = self.spread_calc.calculate_dex_spread(
                    uni_exchange,
                    sushi_exchange,
                    pair,
                    gas_cost
                )
                
                if result.get('viable'):
                    opportunities.append({
                        'type': 'cross_dex',
                        'strategy': f"{result['buy_exchange']} → {result['sell_exchange']}",
                        **result
                    })
                    
            except Exception as e:
                # Skip this pair if error
                continue
        
        return opportunities
    
    def _scan_triangle(
        self,
        uniswap_data: Dict,
        gas_cost: float
    ) -> List[Dict]:
        """Scan for triangle arbitrage on Uniswap."""
        
        opportunities = []
        
        pools = uniswap_data.get('data', {}).get('pools', [])
        
        for path in self.triangle_paths:
            try:
                # Build pool data for this path
                pool_data = []
                
                for i in range(len(path) - 1):
                    token_in = path[i]
                    token_out = path[i + 1]
                    
                    # Find matching pool
                    pool = self._find_pool(pools, token_in, token_out)
                    
                    if pool:
                        pool_data.append({
                            'exchange': 'uniswap_v3',
                            'pool_id': pool.get('id'),
                            'fee_tier': self._get_fee_tier(pool),
                            'rate': self._calculate_rate(pool, token_in, token_out),
                            'liquidity': pool.get('liquidity', 0)
                        })
                
                # Need all pools in path
                if len(pool_data) == len(path) - 1:
                    result = self.spread_calc.calculate_triangle_arb(
                        path,
                        pool_data,
                        gas_cost,
                        amount_in=1.0  # Start with 1 ETH
                    )
                    
                    if result.get('viable'):
                        opportunities.append({
                            'type': 'triangle',
                            'strategy': ' → '.join(path),
                            **result
                        })
                        
            except Exception as e:
                # Skip this path if error
                continue
        
        return opportunities
    
    def _scan_stablecoin(
        self,
        curve_data: Dict,
        gas_cost: float
    ) -> List[Dict]:
        """Scan for stablecoin depeg opportunities on Curve."""
        
        opportunities = []
        
        depeg_opps = curve_data.get('data', {}).get('opportunities', [])
        
        for opp in depeg_opps:
            try:
                # Build coin data
                coin_data = {
                    'symbol': opp.get('coin'),
                    'price': opp.get('actualPrice')
                }
                
                result = self.spread_calc.calculate_stablecoin_arb(
                    coin_data,
                    target_peg=1.0,
                    gas_cost_usd=gas_cost
                )
                
                if result.get('viable'):
                    opportunities.append({
                        'type': 'stablecoin_depeg',
                        'strategy': f"{opp.get('arbitrageType')} {opp.get('coin')} on Curve",
                        'pool': opp.get('pool'),
                        **result
                    })
                    
            except Exception as e:
                # Skip this opportunity if error
                continue
        
        return opportunities
    
    # Helper methods
    
    def _validate_data(self, data: Dict) -> bool:
        """Check if fetcher data is valid."""
        if not data:
            return False
        
        if data.get('status') != 'success':
            return False
        
        if 'data' not in data:
            return False
        
        return True
    
    def _extract_gas_cost(self, gas_data: Dict, tx_type: str) -> Optional[float]:
        """Extract gas cost for a transaction type."""
        
        if not self._validate_data(gas_data):
            return None
        
        thresholds = gas_data.get('data', {}).get('thresholds', {})
        
        if tx_type not in thresholds:
            return None
        
        # Use 'fast' speed for flash loans
        tx_threshold = thresholds[tx_type]
        return tx_threshold.get('fast', {}).get('gasCostUSD', 25.0)
    
    def _get_liquidity(self, exchange_data: Dict, pair: str) -> Optional[float]:
        """Get liquidity for a specific pair."""
        
        pools = exchange_data.get('data', {}).get('pools', [])
        
        for pool in pools:
            if pool.get('pair') == pair:
                return pool.get('tvlUSD', 0)
        
        # Also check prices array
        prices = exchange_data.get('data', {}).get('prices', [])
        for price_data in prices:
            if price_data.get('pair') == pair:
                return price_data.get('liquidity', 0)
        
        return None
    
    def _find_pool(self, pools: List[Dict], token_in: str, token_out: str) -> Optional[Dict]:
        """Find a pool that contains both tokens."""
        
        for pool in pools:
            pair = pool.get('pair', '')
            
            # Check both directions
            if (token_in in pair and token_out in pair):
                return pool
        
        return None
    
    def _get_fee_tier(self, pool: Dict) -> str:
        """Get fee tier from pool data."""
        
        fee_tier = pool.get('feeTier', 3000)  # Default 0.3%
        
        # Convert to percentage string
        if fee_tier == 500:
            return '0.05%'
        elif fee_tier == 3000:
            return '0.3%'
        elif fee_tier == 10000:
            return '1%'
        else:
            return '0.3%'
    
    def _calculate_rate(self, pool: Dict, token_in: str, token_out: str) -> float:
        """Calculate exchange rate from pool."""
        
        # Check which token is token0
        token0 = pool.get('token0', {}).get('symbol', '')
        token1 = pool.get('token1', {}).get('symbol', '')
        
        token0_price = pool.get('token0Price', 1.0)
        token1_price = pool.get('token1Price', 1.0)
        
        if token_in == token0 and token_out == token1:
            return float(token0_price)
        elif token_in == token1 and token_out == token0:
            return float(token1_price)
        else:
            # Fallback: use general price if available
            return pool.get('price', 1.0)
    
    def get_stats(self) -> Dict:
        """Get detector statistics."""
        return {
            'opportunities_found': self.opportunities_found,
            'opportunities_viable': self.opportunities_viable,
            'viable_rate': round((self.opportunities_viable / self.opportunities_found * 100), 2) if self.opportunities_found > 0 else 0,
            'last_scan': self.last_scan_time
        }


# Testing
if __name__ == '__main__':
    print("Testing Opportunity Detector...\n")
    print("="*60)
    
    detector = OpportunityDetector(min_profit_usd=50.0)
    
    # Mock data for testing
    print("\n🧪 Test Mode: Using mock data\n")
    
    mock_uniswap = {
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
                    'token1Price': 0.000416597,
                    'feeTier': 3000,
                    'liquidity': 100000000,
                    'tvlUSD': 100000000
                }
            ]
        }
    }
    
    mock_sushiswap = {
        'status': 'success',
        'data': {
            'prices': [
                {'pair': 'ETH/USDC', 'price': 2410.00, 'liquidity': 50000000}
            ],
            'pools': []
        }
    }
    
    mock_curve = {
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
    }
    
    mock_gas = {
        'status': 'success',
        'data': {
            'thresholds': {
                'simpleSwap': {
                    'fast': {'gasCostUSD': 15.0}
                },
                'flashLoanTriangle': {
                    'fast': {'gasCostUSD': 35.0}
                }
            },
            'networkState': {
                'congestion': 'normal',
                'flashLoanViable': True
            }
        }
    }
    
    # Run scan
    result = detector.scan_all(
        mock_uniswap,
        mock_sushiswap,
        mock_curve,
        mock_gas
    )
    
    print(json.dumps(result, indent=2))
    
    print("\n" + "="*60)
    print("📊 SCAN RESULTS")
    print("="*60)
    
    if result['status'] == 'success':
        stats = result['stats']
        print(f"\n✅ Scan completed in {result['scan_duration_ms']}ms")
        print(f"   Total opportunities: {stats['total_found']}")
        print(f"   Viable opportunities: {stats['viable_count']}")
        print(f"   Viable rate: {stats['viable_percentage']}%")
        
        if result['top_opportunity']:
            top = result['top_opportunity']
            print(f"\n🎯 BEST OPPORTUNITY:")
            print(f"   Type: {top['type']}")
            print(f"   Strategy: {top['strategy']}")
            print(f"   Net Profit: ${top['profit']['net_usd']:.2f}")
            print(f"   Profit (bps): {top['profit']['net_bps']:.2f}")
        
        print(f"\n🌐 Network: {result['network_state'].get('congestion', 'unknown')}")
        print(f"   Gas cost: ${result['gas_cost_usd']:.2f}")
        
    else:
        print(f"\n❌ Scan failed: {result.get('error', 'Unknown error')}")
    
    print("\n" + "="*60)
    print("💡 NOTE: This is test mode with mock data")
    print("   Real data requires running fetchers first")
    print("="*60)
