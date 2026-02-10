"""
Spread Calculator - Phase 1
Calculates price spreads between exchanges for arbitrage opportunities.
Works with data from DEX fetchers (Uniswap, Sushiswap, Curve).
"""

import json
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import math


class SpreadCalculator:
    """
    Calculate spreads between exchanges and determine arbitrage viability.
    
    Accounts for:
    - Exchange fees (Uniswap 0.05-1%, Sushiswap 0.3%, Curve 0.04%)
    - Gas costs (from gasPriceOracle)
    - Slippage (from liquidity depth)
    - Flash loan fees (Aave 0.09%)
    """
    
    def __init__(self):
        # Exchange fee tiers (in basis points)
        self.exchange_fees = {
            'uniswap_v3': {
                '0.05%': 5,   # 5 basis points
                '0.3%': 30,   # 30 basis points
                '1%': 100     # 100 basis points
            },
            'sushiswap': 30,  # 0.3% flat
            'curve': 4        # 0.04% typical
        }
        
        # Flash loan fees (basis points)
        self.flash_loan_fee = 9  # Aave: 0.09%
        
        # Minimum profit threshold (basis points)
        self.min_profit_bps = 20  # 0.2%
        
    def calculate_dex_spread(
        self,
        exchange1_data: Dict,
        exchange2_data: Dict,
        pair: str,
        gas_cost_usd: float
    ) -> Dict:
        """
        Calculate spread between two DEXs for the same pair.
        
        Args:
            exchange1_data: Price data from first DEX
            exchange2_data: Price data from second DEX
            pair: Trading pair (e.g., "ETH/USDC")
            gas_cost_usd: Estimated gas cost in USD
            
        Returns:
            Dict with spread analysis
        """
        
        # Extract prices
        price1 = self._extract_price(exchange1_data, pair)
        price2 = self._extract_price(exchange2_data, pair)
        
        if price1 is None or price2 is None:
            return {
                'viable': False,
                'reason': 'Price data unavailable'
            }
        
        # Calculate raw spread
        spread_abs = abs(price1 - price2)
        spread_pct = (spread_abs / min(price1, price2)) * 100
        spread_bps = spread_pct * 100
        
        # Determine buy/sell exchanges
        buy_exchange = exchange1_data['exchange'] if price1 < price2 else exchange2_data['exchange']
        sell_exchange = exchange2_data['exchange'] if price1 < price2 else exchange1_data['exchange']
        buy_price = min(price1, price2)
        sell_price = max(price1, price2)
        
        # Calculate fees
        buy_fee_bps = self._get_exchange_fee(buy_exchange, exchange1_data.get('fee_tier'))
        sell_fee_bps = self._get_exchange_fee(sell_exchange, exchange2_data.get('fee_tier'))
        total_fee_bps = buy_fee_bps + sell_fee_bps + self.flash_loan_fee
        
        # Calculate net profit
        gross_profit_bps = spread_bps
        net_profit_bps = gross_profit_bps - total_fee_bps
        
        # Calculate in USD (assuming $10,000 trade size)
        trade_size_usd = 10000
        gross_profit_usd = (gross_profit_bps / 10000) * trade_size_usd
        fee_cost_usd = (total_fee_bps / 10000) * trade_size_usd
        net_profit_before_gas = gross_profit_usd - fee_cost_usd
        net_profit_usd = net_profit_before_gas - gas_cost_usd
        
        # Check viability
        viable = (
            net_profit_bps > self.min_profit_bps and
            net_profit_usd > 0
        )
        
        return {
            'viable': viable,
            'pair': pair,
            'buy_exchange': buy_exchange,
            'sell_exchange': sell_exchange,
            'buy_price': round(buy_price, 6),
            'sell_price': round(sell_price, 6),
            'spread': {
                'absolute': round(spread_abs, 6),
                'percentage': round(spread_pct, 4),
                'basis_points': round(spread_bps, 2)
            },
            'fees': {
                'buy_fee_bps': buy_fee_bps,
                'sell_fee_bps': sell_fee_bps,
                'flash_loan_fee_bps': self.flash_loan_fee,
                'total_fee_bps': total_fee_bps,
                'fee_cost_usd': round(fee_cost_usd, 2)
            },
            'profit': {
                'gross_bps': round(gross_profit_bps, 2),
                'net_bps': round(net_profit_bps, 2),
                'gross_usd': round(gross_profit_usd, 2),
                'gas_cost_usd': round(gas_cost_usd, 2),
                'net_usd': round(net_profit_usd, 2)
            },
            'recommended_trade_size': self._calculate_optimal_size(
                net_profit_bps,
                gas_cost_usd,
                exchange1_data.get('liquidity'),
                exchange2_data.get('liquidity')
            ),
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def calculate_triangle_arb(
        self,
        path: List[str],
        pool_data: List[Dict],
        gas_cost_usd: float,
        amount_in: float = 1.0
    ) -> Dict:
        """
        Calculate triangle arbitrage opportunity (e.g., ETH → USDC → DAI → ETH).
        
        Args:
            path: Trading path (e.g., ["ETH", "USDC", "DAI", "ETH"])
            pool_data: Pool data for each swap in the path
            gas_cost_usd: Estimated gas cost
            amount_in: Starting amount (in first token)
            
        Returns:
            Dict with triangle arbitrage analysis
        """
        
        if len(path) < 3:
            return {
                'viable': False,
                'reason': 'Path too short for triangle arbitrage'
            }
        
        # Track amount through the path
        current_amount = amount_in
        swaps = []
        total_fee_bps = 0
        
        for i in range(len(path) - 1):
            token_in = path[i]
            token_out = path[i + 1]
            pool = pool_data[i] if i < len(pool_data) else None
            
            if pool is None:
                return {
                    'viable': False,
                    'reason': f'No pool data for {token_in}/{token_out}'
                }
            
            # Get exchange rate
            rate = self._get_exchange_rate(pool, token_in, token_out)
            
            if rate is None:
                return {
                    'viable': False,
                    'reason': f'No rate for {token_in}/{token_out}'
                }
            
            # Calculate output amount (accounting for fee)
            fee_bps = self._get_exchange_fee(pool['exchange'], pool.get('fee_tier'))
            fee_multiplier = 1 - (fee_bps / 10000)
            amount_out = current_amount * rate * fee_multiplier
            
            swaps.append({
                'token_in': token_in,
                'token_out': token_out,
                'amount_in': round(current_amount, 6),
                'amount_out': round(amount_out, 6),
                'rate': round(rate, 6),
                'fee_bps': fee_bps,
                'exchange': pool['exchange'],
                'pool_id': pool.get('pool_id')
            })
            
            current_amount = amount_out
            total_fee_bps += fee_bps
        
        # Calculate profit
        final_amount = current_amount
        profit_amount = final_amount - amount_in
        profit_pct = (profit_amount / amount_in) * 100
        profit_bps = profit_pct * 100
        
        # Add flash loan fee
        total_fee_bps += self.flash_loan_fee
        net_profit_bps = profit_bps - self.flash_loan_fee
        
        # Estimate USD values (assume ETH = $2400)
        eth_price = 2400
        profit_usd = profit_amount * eth_price
        net_profit_usd = profit_usd - gas_cost_usd
        
        # Check viability
        viable = (
            profit_bps > 0 and
            net_profit_bps > self.min_profit_bps and
            net_profit_usd > 0
        )
        
        return {
            'viable': viable,
            'path': path,
            'amount_in': round(amount_in, 6),
            'amount_out': round(final_amount, 6),
            'swaps': swaps,
            'profit': {
                'amount': round(profit_amount, 6),
                'percentage': round(profit_pct, 4),
                'basis_points': round(profit_bps, 2),
                'net_bps': round(net_profit_bps, 2),
                'gross_usd': round(profit_usd, 2),
                'gas_cost_usd': round(gas_cost_usd, 2),
                'net_usd': round(net_profit_usd, 2)
            },
            'fees': {
                'total_fee_bps': total_fee_bps,
                'flash_loan_fee_bps': self.flash_loan_fee
            },
            'recommended_amount_in': self._calculate_optimal_triangle_size(
                net_profit_bps,
                gas_cost_usd,
                pool_data
            ),
            'timestamp': datetime.utcnow().isoformat()
        }
    
    def calculate_stablecoin_arb(
        self,
        coin_data: Dict,
        target_peg: float = 1.0,
        gas_cost_usd: float = 20.0
    ) -> Dict:
        """
        Calculate stablecoin depeg arbitrage (Curve specialty).
        
        Args:
            coin_data: Stablecoin price data from Curve
            target_peg: Expected peg price (usually $1.00)
            gas_cost_usd: Estimated gas cost
            
        Returns:
            Dict with depeg arbitrage analysis
        """
        
        current_price = coin_data.get('price', target_peg)
        deviation = abs(current_price - target_peg)
        deviation_pct = (deviation / target_peg) * 100
        deviation_bps = deviation_pct * 100
        
        # Determine trade direction
        if current_price < target_peg:
            direction = 'BUY'  # Buy cheap, sell at peg
            entry_price = current_price
            exit_price = target_peg
        else:
            direction = 'SELL'  # Sell expensive, buy at peg
            entry_price = current_price
            exit_price = target_peg
        
        # Calculate profit
        gross_profit = abs(exit_price - entry_price)
        gross_profit_pct = (gross_profit / entry_price) * 100
        gross_profit_bps = gross_profit_pct * 100
        
        # Curve fees are very low (0.04%)
        curve_fee_bps = 4
        total_fee_bps = curve_fee_bps + self.flash_loan_fee
        
        net_profit_bps = gross_profit_bps - total_fee_bps
        
        # USD calculations (assuming $10,000 trade)
        trade_size_usd = 10000
        gross_profit_usd = (gross_profit_bps / 10000) * trade_size_usd
        fee_cost_usd = (total_fee_bps / 10000) * trade_size_usd
        net_profit_usd = gross_profit_usd - fee_cost_usd - gas_cost_usd
        
        # Viability
        viable = (
            deviation_bps > 10 and  # At least 0.1% deviation
            net_profit_bps > self.min_profit_bps and
            net_profit_usd > 0
        )
        
        return {
            'viable': viable,
            'coin': coin_data.get('symbol', 'UNKNOWN'),
            'current_price': round(current_price, 6),
            'target_peg': target_peg,
            'deviation': {
                'absolute': round(deviation, 6),
                'percentage': round(deviation_pct, 4),
                'basis_points': round(deviation_bps, 2)
            },
            'strategy': {
                'direction': direction,
                'entry_price': round(entry_price, 6),
                'exit_price': round(exit_price, 6)
            },
            'profit': {
                'gross_bps': round(gross_profit_bps, 2),
                'net_bps': round(net_profit_bps, 2),
                'gross_usd': round(gross_profit_usd, 2),
                'gas_cost_usd': round(gas_cost_usd, 2),
                'net_usd': round(net_profit_usd, 2)
            },
            'fees': {
                'curve_fee_bps': curve_fee_bps,
                'flash_loan_fee_bps': self.flash_loan_fee,
                'total_fee_bps': total_fee_bps
            },
            'risk': self._assess_depeg_risk(coin_data, deviation_bps),
            'timestamp': datetime.utcnow().isoformat()
        }
    
    # Helper methods
    
    def _extract_price(self, exchange_data: Dict, pair: str) -> Optional[float]:
        """Extract price for a specific pair from exchange data."""
        prices = exchange_data.get('prices', [])
        for price_data in prices:
            if price_data.get('pair') == pair:
                return price_data.get('price')
        return None
    
    def _get_exchange_fee(self, exchange: str, fee_tier: Optional[str] = None) -> int:
        """Get fee in basis points for an exchange."""
        if 'uniswap' in exchange.lower():
            if fee_tier:
                return self.exchange_fees['uniswap_v3'].get(fee_tier, 30)
            return 30  # Default to 0.3%
        elif 'sushiswap' in exchange.lower():
            return self.exchange_fees['sushiswap']
        elif 'curve' in exchange.lower():
            return self.exchange_fees['curve']
        else:
            return 30  # Default 0.3%
    
    def _get_exchange_rate(self, pool: Dict, token_in: str, token_out: str) -> Optional[float]:
        """Get exchange rate from pool data."""
        # This would parse the pool structure to find the rate
        # Simplified for now
        if 'rate' in pool:
            return pool['rate']
        elif 'price' in pool:
            return pool['price']
        return None
    
    def _calculate_optimal_size(
        self,
        net_profit_bps: float,
        gas_cost_usd: float,
        liquidity1: Optional[float],
        liquidity2: Optional[float]
    ) -> Dict:
        """Calculate optimal trade size based on profit and liquidity."""
        
        # Minimum size to cover gas costs
        min_size = (gas_cost_usd * 10000) / max(net_profit_bps, 1)
        
        # Maximum size based on liquidity (don't use more than 10% of pool)
        max_size = float('inf')
        if liquidity1 and liquidity2:
            min_liquidity = min(liquidity1, liquidity2)
            max_size = min_liquidity * 0.1  # 10% max
        
        return {
            'min_size_usd': round(min_size, 2),
            'max_size_usd': round(max_size, 2) if max_size != float('inf') else None,
            'recommended_usd': round(min(min_size * 2, max_size), 2) if max_size != float('inf') else round(min_size * 2, 2)
        }
    
    def _calculate_optimal_triangle_size(
        self,
        net_profit_bps: float,
        gas_cost_usd: float,
        pool_data: List[Dict]
    ) -> Dict:
        """Calculate optimal size for triangle arbitrage."""
        
        # Minimum to cover gas
        min_size_eth = gas_cost_usd / 2400  # Assume ETH = $2400
        
        # Consider liquidity of all pools in path
        # (Simplified - would need more sophisticated analysis)
        
        return {
            'min_size_eth': round(min_size_eth, 4),
            'recommended_eth': round(min_size_eth * 2, 4)
        }
    
    def _assess_depeg_risk(self, coin_data: Dict, deviation_bps: float) -> Dict:
        """Assess risk of stablecoin depeg arbitrage."""
        
        risk_level = 'low'
        factors = []
        
        if deviation_bps > 100:  # >1% deviation
            risk_level = 'medium'
            factors.append('Large deviation may indicate systemic issue')
        
        if deviation_bps > 500:  # >5% deviation
            risk_level = 'high'
            factors.append('Extreme deviation - may not return to peg')
        
        return {
            'level': risk_level,
            'factors': factors,
            'recommendation': 'Proceed with caution' if risk_level != 'low' else 'Low risk'
        }


# Testing
if __name__ == '__main__':
    print("Testing Spread Calculator...\n")
    
    calc = SpreadCalculator()
    
    # Test 1: DEX spread
    print("Test 1: Cross-DEX Spread (Uniswap vs Sushiswap)")
    uniswap_data = {
        'exchange': 'uniswap_v3',
        'prices': [{'pair': 'ETH/USDC', 'price': 2400.50}],
        'fee_tier': '0.3%',
        'liquidity': 100000000
    }
    sushiswap_data = {
        'exchange': 'sushiswap',
        'prices': [{'pair': 'ETH/USDC', 'price': 2410.00}],
        'liquidity': 50000000
    }
    
    result = calc.calculate_dex_spread(
        uniswap_data,
        sushiswap_data,
        'ETH/USDC',
        gas_cost_usd=25.0
    )
    
    print(json.dumps(result, indent=2))
    print(f"\nViable: {'YES ✅' if result['viable'] else 'NO ❌'}")
    
    # Test 2: Stablecoin depeg
    print("\n" + "="*60)
    print("Test 2: Stablecoin Depeg (USDC)")
    usdc_data = {
        'symbol': 'USDC',
        'price': 0.9975  # 0.25% below peg
    }
    
    result2 = calc.calculate_stablecoin_arb(usdc_data, gas_cost_usd=15.0)
    print(json.dumps(result2, indent=2))
    print(f"\nViable: {'YES ✅' if result2['viable'] else 'NO ❌'}")
