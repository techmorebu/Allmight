#!/usr/bin/env python3
"""
Advanced Arbitrage Detector - All Strategies
Finds: Triangle, Multi-hop, Same-DEX, Cross-DEX, Stablecoin arbitrage

Author: Allmight System
Phase: 2.2 + 2.3 Combined
"""

import logging
from typing import Dict, List, Tuple, Optional, Set
from dataclasses import dataclass
from enum import Enum
import itertools

logger = logging.getLogger('Allmight.AdvancedDetector')


class ArbType(Enum):
    """Arbitrage strategy types"""
    CROSS_DEX = "cross_dex"           # Buy DEX A, sell DEX B
    TRIANGLE = "triangle"              # A→B→C→A
    MULTI_HOP = "multi_hop"           # A→B→C instead of A→C
    SAME_DEX_FEE = "same_dex_fee"     # Arbitrage between fee tiers
    STABLECOIN_DEPEG = "stablecoin"   # Depeg arbitrage


@dataclass
class ArbPath:
    """Represents an arbitrage path"""
    path_type: ArbType
    tokens: List[str]                  # Token sequence (e.g., ['ETH', 'USDC', 'DAI', 'ETH'])
    dexs: List[str]                    # DEX for each hop
    pools: List[str]                   # Pool addresses
    prices: List[float]                # Price at each hop
    fees: List[float]                  # Fee at each hop (bps)
    expected_profit_bps: float         # Expected profit in basis points
    execution_complexity: int          # Number of swaps required
    description: str                   # Human-readable description


class AdvancedArbDetector:
    """
    Comprehensive arbitrage detection across all strategies
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        
        # Detection thresholds
        self.min_profit_bps = self.config.get('min_profit_bps', 1)  # 0.1% minimum
        self.max_hops = self.config.get('max_hops', 4)  # Max path length
        self.min_liquidity = self.config.get('min_liquidity', 10_000)  # $10k minimum
        
        # Stablecoin settings
        self.stablecoins = ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD']
        self.stablecoin_peg_tolerance = self.config.get('stablecoin_tolerance', 50)  # 0.5%
        
        # Price graph for pathfinding
        self.price_graph = {}
        self.pool_details = {}
        
    def build_price_graph(self, markets: List[Dict]) -> None:
        """
        Build a directed graph of all possible trades
        
        Graph structure:
        {
            'ETH': {
                'USDC': [
                    {'dex': 'uniswap', 'pool': '0x...', 'price': 1945.0, 'fee': 30, 'liquidity': 1000000},
                    {'dex': 'sushiswap', 'pool': '0x...', 'price': 1943.0, 'fee': 30, 'liquidity': 500000}
                ],
                'WBTC': [...]
            },
            'USDC': {
                'ETH': [...],
                'DAI': [...]
            }
        }
        """
        
        logger.info("🔨 Building price graph from markets...")
        
        self.price_graph = {}
        self.pool_details = {}
        
        for market in markets:
            # Parse market data
            market_info = self._parse_market(market)
            
            if not market_info:
                continue
            
            token0, token1, dex, pool_addr, price, fee, liquidity = market_info
            
            # Add forward direction (token0 → token1)
            if token0 not in self.price_graph:
                self.price_graph[token0] = {}
            
            if token1 not in self.price_graph[token0]:
                self.price_graph[token0][token1] = []
            
            self.price_graph[token0][token1].append({
                'dex': dex,
                'pool': pool_addr,
                'price': price,
                'fee': fee,
                'liquidity': liquidity,
                'inverse': False
            })
            
            # Add reverse direction (token1 → token0)
            if token1 not in self.price_graph:
                self.price_graph[token1] = {}
            
            if token0 not in self.price_graph[token1]:
                self.price_graph[token1][token0] = []
            
            # Inverse price
            inverse_price = 1 / price if price > 0 else 0
            
            self.price_graph[token1][token0].append({
                'dex': dex,
                'pool': pool_addr,
                'price': inverse_price,
                'fee': fee,
                'liquidity': liquidity,
                'inverse': True
            })
            
            # Store pool details for later reference
            pool_key = f"{dex}:{token0}/{token1}"
            self.pool_details[pool_key] = {
                'pool': pool_addr,
                'price': price,
                'fee': fee,
                'liquidity': liquidity
            }
        
        # Log graph statistics
        total_tokens = len(self.price_graph)
        total_edges = sum(len(targets) for targets in self.price_graph.values())
        
        logger.info(f"✅ Price graph built: {total_tokens} tokens, {total_edges} trading pairs")
        
    def _parse_market(self, market: Dict) -> Optional[Tuple]:
        """Parse market data into standardized format"""
        
        try:
            # Extract market name (e.g., "Uniswap ETH/USDC" or "Cross-DEX ETH/USDC")
            name = market.get('name', '')
            
            # Extract DEX
            if name.startswith('Uniswap'):
                dex = 'uniswap'
                pair = name.replace('Uniswap ', '')
            elif name.startswith('Sushiswap'):
                dex = 'sushiswap'
                pair = name.replace('Sushiswap ', '')
            elif name.startswith('Curve'):
                dex = 'curve'
                pair = name.replace('Curve ', '').split()[0]  # Get pool name
            elif 'Cross-DEX' in name:
                # Skip cross-DEX markers (we'll detect these ourselves)
                return None
            else:
                return None
            
            # Parse token pair
            if '/' in pair:
                tokens = pair.split('/')
                if len(tokens) != 2:
                    return None
                token0, token1 = tokens[0].strip(), tokens[1].strip()
            else:
                return None
            
            # Get price, fee, liquidity
            price = market.get('price', 0)
            spread_bps = market.get('spread_bps', 30)  # Default 0.3%
            liquidity = market.get('pool_liquidity', 0)
            
            # For spread_bps, treat it as fee for now
            fee = spread_bps
            
            # Pool address (if available)
            pool_addr = market.get('pool', f"{dex}:{pair}")
            
            return (token0, token1, dex, pool_addr, price, fee, liquidity)
            
        except Exception as e:
            logger.debug(f"Failed to parse market {market.get('name', 'unknown')}: {e}")
            return None
    
    def find_all_arbitrage(self, markets: List[Dict], gas_cost_usd: float = 2.0) -> List[ArbPath]:
        """
        Master function: Find ALL arbitrage opportunities
        
        Returns: List of ArbPath objects sorted by profitability
        """
        
        logger.info("=" * 70)
        logger.info("🔍 ADVANCED ARBITRAGE DETECTION - ALL STRATEGIES")
        logger.info("=" * 70)
        
        # Build graph
        self.build_price_graph(markets)
        
        if not self.price_graph:
            logger.warning("⚠️  No valid markets to analyze")
            return []
        
        all_opportunities = []
        
        # Strategy 1: Cross-DEX arbitrage
        logger.info("🔄 Detecting cross-DEX arbitrage...")
        cross_dex = self._find_cross_dex_arbitrage()
        all_opportunities.extend(cross_dex)
        logger.info(f"   Found {len(cross_dex)} cross-DEX opportunities")
        
        # Strategy 2: Triangle arbitrage
        logger.info("🔺 Detecting triangle arbitrage...")
        triangles = self._find_triangle_arbitrage()
        all_opportunities.extend(triangles)
        logger.info(f"   Found {len(triangles)} triangle opportunities")
        
        # Strategy 3: Multi-hop routing
        logger.info("🛤️  Detecting multi-hop routes...")
        multihop = self._find_multihop_arbitrage()
        all_opportunities.extend(multihop)
        logger.info(f"   Found {len(multihop)} multi-hop opportunities")
        
        # Strategy 4: Same-DEX fee tier arbitrage
        logger.info("💱 Detecting same-DEX fee arbitrage...")
        same_dex = self._find_same_dex_arbitrage()
        all_opportunities.extend(same_dex)
        logger.info(f"   Found {len(same_dex)} same-DEX opportunities")
        
        # Strategy 5: Stablecoin depeg arbitrage
        logger.info("🪙  Detecting stablecoin depeg arbitrage...")
        stablecoin = self._find_stablecoin_arbitrage()
        all_opportunities.extend(stablecoin)
        logger.info(f"   Found {len(stablecoin)} stablecoin opportunities")
        
        # Filter by profitability
        profitable = [
            opp for opp in all_opportunities 
            if opp.expected_profit_bps >= self.min_profit_bps
        ]
        
        # Sort by profit
        profitable.sort(key=lambda x: x.expected_profit_bps, reverse=True)
        
        logger.info("=" * 70)
        logger.info(f"✅ Total opportunities found: {len(profitable)}")
        logger.info("=" * 70)
        
        return profitable
    
    def _find_cross_dex_arbitrage(self) -> List[ArbPath]:
        """Find simple cross-DEX arbitrage (buy on A, sell on B)"""
        
        opportunities = []
        
        # For each token pair, check if price differs across DEXs
        checked_pairs = set()
        
        for token0 in self.price_graph:
            for token1 in self.price_graph.get(token0, {}):
                
                pair_key = tuple(sorted([token0, token1]))
                if pair_key in checked_pairs:
                    continue
                checked_pairs.add(pair_key)
                
                # Get all routes for this pair
                routes_forward = self.price_graph.get(token0, {}).get(token1, [])
                routes_backward = self.price_graph.get(token1, {}).get(token0, [])
                
                # Need at least 2 DEXs to arbitrage
                if len(routes_forward) < 2:
                    continue
                
                # Check all DEX pairs
                for i, route1 in enumerate(routes_forward):
                    for route2 in routes_forward[i+1:]:
                        
                        # Different DEXs only
                        if route1['dex'] == route2['dex']:
                            continue
                        
                        # Calculate profit: buy on cheaper, sell on expensive
                        price1 = route1['price']
                        price2 = route2['price']
                        
                        if price1 == 0 or price2 == 0:
                            continue
                        
                        # Determine direction
                        if price1 < price2:
                            buy_dex = route1
                            sell_dex = route2
                        else:
                            buy_dex = route2
                            sell_dex = route1
                        
                        # Calculate profit after fees
                        # For cross-DEX: we want to know if we can profit from buying on one, selling on other
                        
                        # Buy on cheaper DEX, sell on more expensive DEX
                        if price1 > price2:
                            # Buy on route2, sell on route1
                            buy_price = price2
                            sell_price = price1
                            buy_route = route2
                            sell_route = route1
                        else:
                            # Buy on route1, sell on route2
                            buy_price = price1
                            sell_price = price2
                            buy_route = route1
                            sell_route = route2
                        
                        # For same token pair on different DEXs, the prices should be similar
                        # Profit = (sell_price / buy_price - 1) * 10000 - fees
                        price_ratio = sell_price / buy_price if buy_price > 0 else 0
                        
                        # Calculate gross profit
                        gross_profit_bps = (price_ratio - 1) * 10000
                        
                        # Subtract fees
                        total_fees_bps = buy_route['fee'] + sell_route['fee']
                        net_profit_bps = gross_profit_bps - total_fees_bps
                        
                        # Only profitable if spread > fees
                        if net_profit_bps >= self.min_profit_bps:
                            opportunities.append(ArbPath(
                                path_type=ArbType.CROSS_DEX,
                                tokens=[token0, token1, token0],
                                dexs=[buy_route['dex'], sell_route['dex']],
                                pools=[buy_route['pool'], sell_route['pool']],
                                prices=[buy_price, sell_price],
                                fees=[buy_route['fee'], sell_route['fee']],
                                expected_profit_bps=net_profit_bps,
                                execution_complexity=2,
                                description=f"Buy {token0}/{token1} on {buy_route['dex']}, sell on {sell_route['dex']}"
                            ))
        return opportunities
    
    def _find_triangle_arbitrage(self) -> List[ArbPath]:
        """Find triangle arbitrage (A→B→C→A)"""
        
        opportunities = []
        
        # Get all tokens
        tokens = list(self.price_graph.keys())
        
        # Try all 3-token combinations
        for token_a in tokens:
            for token_b in self.price_graph.get(token_a, {}):
                for token_c in self.price_graph.get(token_b, {}):
                    
                    # Check if we can return to token_a from token_c
                    if token_a not in self.price_graph.get(token_c, {}):
                        continue
                    
                    # Avoid trivial cycles
                    if token_a == token_b or token_b == token_c or token_a == token_c:
                        continue
                    
                    # Get best route for each leg
                    route_ab = self._get_best_route(token_a, token_b)
                    route_bc = self._get_best_route(token_b, token_c)
                    route_ca = self._get_best_route(token_c, token_a)
                    
                    if not (route_ab and route_bc and route_ca):
                        continue
                    
                    # Calculate profit
                    prices = [route_ab['price'], route_bc['price'], route_ca['price']]
                    fees = [route_ab['fee'], route_bc['fee'], route_ca['fee']]
                    
                    profit_bps = self._calculate_path_profit(prices, fees)
                    
                    if profit_bps >= self.min_profit_bps:
                        opportunities.append(ArbPath(
                            path_type=ArbType.TRIANGLE,
                            tokens=[token_a, token_b, token_c, token_a],
                            dexs=[route_ab['dex'], route_bc['dex'], route_ca['dex']],
                            pools=[route_ab['pool'], route_bc['pool'], route_ca['pool']],
                            prices=prices,
                            fees=fees,
                            expected_profit_bps=profit_bps,
                            execution_complexity=3,
                            description=f"Triangle: {token_a}→{token_b}→{token_c}→{token_a}"
                        ))
        
        return opportunities
    
    def _find_multihop_arbitrage(self) -> List[ArbPath]:
        """Find multi-hop routing opportunities"""
        
        opportunities = []
        
        # For each direct pair, check if indirect route is better
        for token_a in self.price_graph:
            for token_c in self.price_graph.get(token_a, {}):
                
                # Get direct route
                direct_route = self._get_best_route(token_a, token_c)
                if not direct_route:
                    continue
                
                direct_price = direct_route['price']
                direct_fee = direct_route['fee']
                
                # Try all intermediate tokens
                for token_b in self.price_graph.get(token_a, {}):
                    
                    if token_b == token_c:
                        continue
                    
                    # Check if token_b → token_c exists
                    if token_c not in self.price_graph.get(token_b, {}):
                        continue
                    
                    # Get indirect route (A → B → C)
                    route_ab = self._get_best_route(token_a, token_b)
                    route_bc = self._get_best_route(token_b, token_c)
                    
                    if not (route_ab and route_bc):
                        continue
                    
                    # Calculate effective price through route
                    indirect_price = route_ab['price'] * route_bc['price']
                    indirect_fees = route_ab['fee'] + route_bc['fee']
                    
                    # Compare: is indirect better than direct?
                    # (accounting for fees)
                    direct_after_fee = direct_price * (1 - direct_fee / 10000)
                    indirect_after_fee = indirect_price * (1 - indirect_fees / 10000)
                    
                    if indirect_after_fee > direct_after_fee:
                        profit_bps = ((indirect_after_fee / direct_after_fee) - 1) * 10000
                        
                        if profit_bps >= self.min_profit_bps:
                            opportunities.append(ArbPath(
                                path_type=ArbType.MULTI_HOP,
                                tokens=[token_a, token_b, token_c],
                                dexs=[route_ab['dex'], route_bc['dex']],
                                pools=[route_ab['pool'], route_bc['pool']],
                                prices=[route_ab['price'], route_bc['price']],
                                fees=[route_ab['fee'], route_bc['fee']],
                                expected_profit_bps=profit_bps,
                                execution_complexity=2,
                                description=f"Multi-hop: {token_a}→{token_b}→{token_c} (better than direct)"
                            ))
        
        return opportunities
    
    def _find_same_dex_arbitrage(self) -> List[ArbPath]:
        """Find arbitrage between different pools/fee tiers on same DEX"""
        
        opportunities = []
        
        # For each token pair, check if same DEX has multiple pools
        for token0 in self.price_graph:
            for token1 in self.price_graph.get(token0, {}):
                
                routes = self.price_graph[token0][token1]
                
                # Group by DEX
                dex_routes = {}
                for route in routes:
                    dex = route['dex']
                    if dex not in dex_routes:
                        dex_routes[dex] = []
                    dex_routes[dex].append(route)
                
                # Check each DEX with multiple pools
                for dex, dex_route_list in dex_routes.items():
                    if len(dex_route_list) < 2:
                        continue
                    
                    # Compare all pool pairs
                    for i, pool1 in enumerate(dex_route_list):
                        for pool2 in dex_route_list[i+1:]:
                            
                            # Calculate profit from price difference
                            price_diff_bps = abs(pool1['price'] - pool2['price']) / min(pool1['price'], pool2['price']) * 10000
                            
                            # Account for fees
                            total_fees = pool1['fee'] + pool2['fee']
                            net_profit_bps = price_diff_bps - total_fees
                            
                            if net_profit_bps >= self.min_profit_bps:
                                opportunities.append(ArbPath(
                                    path_type=ArbType.SAME_DEX_FEE,
                                    tokens=[token0, token1, token0],
                                    dexs=[dex, dex],
                                    pools=[pool1['pool'], pool2['pool']],
                                    prices=[pool1['price'], pool2['price']],
                                    fees=[pool1['fee'], pool2['fee']],
                                    expected_profit_bps=net_profit_bps,
                                    execution_complexity=2,
                                    description=f"Same-DEX {dex}: {token0}/{token1} fee tier arbitrage"
                                ))
        
        return opportunities
    
    def _find_stablecoin_arbitrage(self) -> List[ArbPath]:
        """Find stablecoin depeg arbitrage opportunities"""
        
        opportunities = []
        
        # Check all stablecoin pairs
        for i, stable1 in enumerate(self.stablecoins):
            for stable2 in self.stablecoins[i+1:]:
                
                if stable1 not in self.price_graph or stable2 not in self.price_graph.get(stable1, {}):
                    continue
                
                # Get best route
                route = self._get_best_route(stable1, stable2)
                if not route:
                    continue
                
                price = route['price']
                fee = route['fee']
                
                # Check if depegged (should be 1.0)
                depeg_bps = abs(price - 1.0) * 10000
                
                # Profit = depeg size - fees
                net_profit_bps = depeg_bps - fee
                
                if net_profit_bps >= self.min_profit_bps and depeg_bps > self.stablecoin_peg_tolerance:
                    opportunities.append(ArbPath(
                        path_type=ArbType.STABLECOIN_DEPEG,
                        tokens=[stable1, stable2, stable1],
                        dexs=[route['dex'], route['dex']],
                        pools=[route['pool'], route['pool']],
                        prices=[price, 1/price],
                        fees=[fee, fee],
                        expected_profit_bps=net_profit_bps,
                        execution_complexity=2,
                        description=f"Stablecoin depeg: {stable1}/{stable2} = ${price:.4f} (expected $1.00)"
                    ))
        
        return opportunities
    
    def _get_best_route(self, token_from: str, token_to: str) -> Optional[Dict]:
        """Get the best (lowest price after fees) route between two tokens"""
        
        routes = self.price_graph.get(token_from, {}).get(token_to, [])
        
        if not routes:
            return None
        
        # Find route with best effective price (after fees)
        best_route = None
        best_effective_price = 0
        
        for route in routes:
            # Effective price = price * (1 - fee%)
            effective_price = route['price'] * (1 - route['fee'] / 10000)
            
            if effective_price > best_effective_price:
                best_effective_price = effective_price
                best_route = route
        
        return best_route
    
    def _calculate_path_profit(self, prices: List[float], fees: List[float]) -> float:
        """
        Calculate profit from a path
        
        Returns: Profit in basis points
        """
        
        # Start with 1 unit
        amount = 1.0
        
        # Execute each hop
        for price, fee in zip(prices, fees):
            # Apply swap
            amount = amount * price
            
            # Apply fee
            amount = amount * (1 - fee / 10000)
        
        # Profit = (final_amount - initial_amount) / initial_amount
        profit = (amount - 1.0) * 10000  # Convert to bps
        
        return profit


def format_arb_opportunity(arb: ArbPath) -> str:
    """Format arbitrage opportunity for display"""
    
    tokens_path = " → ".join(arb.tokens)
    dexs_path = " → ".join(arb.dexs)
    
    return (
        f"[{arb.path_type.value.upper()}] {tokens_path}\n"
        f"   DEXs: {dexs_path}\n"
        f"   Profit: {arb.expected_profit_bps:.1f} bps ({arb.expected_profit_bps/100:.2f}%)\n"
        f"   Complexity: {arb.execution_complexity} swaps\n"
        f"   {arb.description}"
    )


# Testing
if __name__ == '__main__':
    # Example usage
    detector = AdvancedArbDetector({
        'min_profit_bps': 10,
        'max_hops': 4
    })
    
    # Mock markets for testing
    test_markets = [
        {'name': 'Uniswap ETH/USDC', 'price': 1945.0, 'spread_bps': 30, 'pool_liquidity': 1000000},
        {'name': 'Sushiswap ETH/USDC', 'price': 1950.0, 'spread_bps': 30, 'pool_liquidity': 500000},
        {'name': 'Uniswap ETH/WBTC', 'price': 0.029, 'spread_bps': 30, 'pool_liquidity': 800000},
        {'name': 'Uniswap WBTC/USDC', 'price': 66500.0, 'spread_bps': 30, 'pool_liquidity': 600000},
    ]
    
    opportunities = detector.find_all_arbitrage(test_markets)
    
    print("\n📊 Found Opportunities:")
    for opp in opportunities:
        print(format_arb_opportunity(opp))
        print()
