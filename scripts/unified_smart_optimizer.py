#!/usr/bin/env python3
"""
Unified Smart Optimizer - Best of All Strategies

Combines:
- Margin Squeezer (maximize profit)
- Micro-Profit Optimizer (find all opportunities)
- Fast Strategy Selector (instant decisions)

Smart Filtering:
- Minimum $10 profit (configurable)
- Batches opportunities to avoid slowdown
- Prioritizes by profit/speed ratio
- Adapts to market conditions
"""

import math
import time
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field
from enum import Enum


class OpportunityTier(Enum):
    """Opportunity quality tiers"""
    JACKPOT = "💎 JACKPOT"        # $500+ profit
    EXCELLENT = "🏆 EXCELLENT"    # $100-500 profit
    GOOD = "✅ GOOD"              # $50-100 profit
    DECENT = "👍 DECENT"          # $10-50 profit
    SKIP = "⏭️ SKIP"             # <$10 profit


@dataclass
class SmartOpportunity:
    """Enhanced opportunity with all metadata"""
    # Core metrics
    pool_name: str
    pool_liquidity: float
    spread_bps: float
    
    # Execution details
    loan_size: float
    expected_profit: float
    slippage_pct: float
    gas_cost: float
    
    # Classification
    tier: OpportunityTier
    viable: bool
    priority_score: float  # Higher = execute first
    
    # Performance
    roi_pct: float
    profit_per_second: float  # Profit / execution_time
    execution_time_ms: float
    
    # Metadata
    reason: str
    timestamp: float = field(default_factory=time.time)


class UnifiedSmartOptimizer:
    """
    Intelligent optimizer that combines all strategies
    
    Philosophy:
    - Find EVERY profitable opportunity
    - Filter for $10+ minimum
    - Prioritize by profit/speed ratio
    - Batch to avoid slowdown
    """
    
    def __init__(self, config: Optional[Dict] = None):
        """
        Initialize with configurable parameters
        
        Args:
            config: Optional config dict with:
                - min_profit_usd: Minimum profit threshold (default: 10)
                - max_slippage_pct: Max slippage (default: 0.5)
                - max_pool_utilization: Max % of pool (default: 0.01)
                - batch_size: Max opportunities to execute per batch (default: 5)
        """
        
        config = config or {}
        
        # Core thresholds
        self.min_profit_usd = config.get('min_profit_usd', 10.0)
        self.max_slippage_pct = config.get('max_slippage_pct', 0.5)
        self.max_pool_utilization = config.get('max_pool_utilization', 0.01)
        
        # Performance tuning
        self.batch_size = config.get('batch_size', 5)  # Execute top 5 per batch
        self.min_execution_gap_ms = config.get('min_execution_gap_ms', 200)  # 200ms between trades
        
        # Fee structure
        self.flash_loan_fee_bps = 9
        self.exchange_fee_bps = 60  # 0.3% x 2
        self.total_fee_bps = 69
        
        # Slippage model
        self.slippage_curve_factor = 1.5
        
        # Pre-computed optimal loans (from margin squeezer)
        self.optimal_loans_lookup = {
            80:  280_000,
            85:  320_000,
            90:  350_000,
            95:  380_000,
            100: 420_000,
            110: 480_000,
            120: 540_000,
            130: 600_000,
            140: 650_000,
            150: 700_000,
            175: 850_000,
            200: 1_000_000
        }
    
    def analyze_opportunity(
        self,
        pool_name: str,
        spread_bps: float,
        pool_liquidity: float,
        gas_cost: float = 2.0
    ) -> SmartOpportunity:
        """
        Analyze single opportunity with all strategies combined
        
        Returns SmartOpportunity with complete analysis
        """
        
        start = time.time()
        
        # Step 1: Find optimal loan size (fast lookup + adjustment)
        optimal_loan = self._find_optimal_loan_fast(
            spread_bps,
            pool_liquidity
        )
        
        # Step 2: Apply safety constraints
        safe_loan = self._apply_safety_limits(
            optimal_loan,
            pool_liquidity
        )
        
        # Step 3: Calculate precise profit
        profit = self._calculate_profit_precise(
            safe_loan,
            spread_bps,
            pool_liquidity,
            gas_cost
        )
        
        # Step 4: Calculate slippage
        slippage = self._calculate_slippage(safe_loan, pool_liquidity)
        
        # Step 5: Determine viability
        viable = (
            profit >= self.min_profit_usd and
            slippage <= self.max_slippage_pct
        )
        
        # Step 6: Classify tier
        tier = self._classify_tier(profit)
        
        # Step 7: Calculate ROI
        roi_pct = (profit / safe_loan * 100) if safe_loan > 0 else 0
        
        # Step 8: Calculate execution time estimate
        execution_time_ms = self._estimate_execution_time(safe_loan, tier)
        
        # Step 9: Calculate priority score
        priority_score = self._calculate_priority(
            profit,
            execution_time_ms,
            tier
        )
        
        # Step 10: Calculate profit per second
        profit_per_second = (profit / (execution_time_ms / 1000)) if execution_time_ms > 0 else 0
        
        # Step 11: Generate reason
        reason = self._generate_reason(profit, spread_bps, slippage, tier)
        
        computation_time = (time.time() - start) * 1000
        
        return SmartOpportunity(
            pool_name=pool_name,
            pool_liquidity=pool_liquidity,
            spread_bps=spread_bps,
            loan_size=safe_loan,
            expected_profit=profit,
            slippage_pct=slippage,
            gas_cost=gas_cost,
            tier=tier,
            viable=viable,
            priority_score=priority_score,
            roi_pct=roi_pct,
            profit_per_second=profit_per_second,
            execution_time_ms=execution_time_ms,
            reason=reason
        )
    
    def scan_markets(
        self,
        markets: List[Dict],
        gas_cost: float = 2.0
    ) -> Dict:
        """
        Scan multiple markets and return prioritized execution plan
        
        Args:
            markets: List of dicts with 'name', 'spread_bps', 'pool_liquidity'
            gas_cost: Current gas cost
            
        Returns:
            Dict with:
                - all_opportunities: All analyzed opportunities
                - viable_opportunities: Only profitable ones
                - execution_batches: Batched by priority
                - summary_stats: Overall statistics
        """
        
        start = time.time()
        
        # Analyze all markets
        opportunities = []
        for market in markets:
            opp = self.analyze_opportunity(
                pool_name=market['name'],
                spread_bps=market['spread_bps'],
                pool_liquidity=market['pool_liquidity'],
                gas_cost=gas_cost
            )
            opportunities.append(opp)
        
        # Filter viable
        viable = [o for o in opportunities if o.viable]
        
        # Sort by priority
        viable.sort(key=lambda x: x.priority_score, reverse=True)
        
        # Create execution batches
        batches = self._create_batches(viable)
        
        # Calculate statistics
        stats = self._calculate_stats(opportunities, viable)
        
        scan_time = (time.time() - start) * 1000
        
        return {
            'all_opportunities': opportunities,
            'viable_opportunities': viable,
            'execution_batches': batches,
            'summary_stats': stats,
            'scan_time_ms': scan_time
        }
    
    def _find_optimal_loan_fast(self, spread_bps: float, pool_liquidity: float) -> float:
        """Fast lookup with interpolation"""
        
        # Get bounds from lookup table
        spreads = sorted(self.optimal_loans_lookup.keys())
        
        if spread_bps < spreads[0]:
            # Too small - return minimal loan
            return 1000
        
        # Find bounding values
        lower = max([s for s in spreads if s <= spread_bps], default=spreads[0])
        upper = min([s for s in spreads if s > spread_bps], default=spreads[-1])
        
        if lower == upper:
            loan_50m = self.optimal_loans_lookup[lower]
        else:
            # Linear interpolation
            lower_loan = self.optimal_loans_lookup[lower]
            upper_loan = self.optimal_loans_lookup[upper]
            weight = (spread_bps - lower) / (upper - lower)
            loan_50m = lower_loan + weight * (upper_loan - lower_loan)
        
        # Adjust for actual pool size
        pool_ratio = pool_liquidity / 50_000_000
        adjusted_loan = loan_50m * math.sqrt(pool_ratio)
        
        return adjusted_loan
    
    def _apply_safety_limits(self, loan: float, pool_liquidity: float) -> float:
        """Apply max slippage and pool utilization limits"""
        
        # Max from pool utilization
        max_from_pool = pool_liquidity * self.max_pool_utilization
        
        # Max from slippage
        max_from_slippage = pool_liquidity * ((self.max_slippage_pct / 100) ** (1 / self.slippage_curve_factor))
        
        # Take minimum
        safe_loan = min(loan, max_from_pool, max_from_slippage)
        
        return safe_loan
    
    def _calculate_slippage(self, loan: float, pool: float) -> float:
        """Calculate slippage percentage"""
        if pool == 0:
            return 100.0
        return ((loan / pool) ** self.slippage_curve_factor) * 100
    
    def _calculate_profit_precise(
        self,
        loan: float,
        spread_bps: float,
        pool: float,
        gas: float
    ) -> float:
        """Precise profit calculation"""
        
        if loan == 0:
            return -gas
        
        # Slippage impact
        slippage_pct = self._calculate_slippage(loan, pool)
        total_slippage_bps = slippage_pct * 2 * 100
        
        # Effective spread
        effective_spread = spread_bps - total_slippage_bps
        
        if effective_spread <= 0:
            return -gas
        
        # Calculate profit
        gross = (effective_spread / 10000) * loan
        fees = (self.total_fee_bps / 10000) * loan
        net = gross - fees - gas
        
        return net
    
    def _classify_tier(self, profit: float) -> OpportunityTier:
        """Classify opportunity by profit"""
        if profit >= 500:
            return OpportunityTier.JACKPOT
        elif profit >= 100:
            return OpportunityTier.EXCELLENT
        elif profit >= 50:
            return OpportunityTier.GOOD
        elif profit >= 10:
            return OpportunityTier.DECENT
        else:
            return OpportunityTier.SKIP
    
    def _estimate_execution_time(self, loan_size: float, tier: OpportunityTier) -> float:
        """Estimate execution time in ms"""
        
        # Base time by tier
        base_times = {
            OpportunityTier.JACKPOT: 300,    # Worth optimizing
            OpportunityTier.EXCELLENT: 200,
            OpportunityTier.GOOD: 150,
            OpportunityTier.DECENT: 100,     # Fast execution
            OpportunityTier.SKIP: 50
        }
        
        base = base_times.get(tier, 150)
        
        # Add overhead for larger loans (more gas, verification)
        if loan_size > 500_000:
            base += 50
        
        return base
    
    def _calculate_priority(
        self,
        profit: float,
        execution_time_ms: float,
        tier: OpportunityTier
    ) -> float:
        """
        Calculate priority score
        
        Higher score = execute first
        
        Formula: (profit / execution_time) * tier_multiplier
        """
        
        tier_multipliers = {
            OpportunityTier.JACKPOT: 2.0,
            OpportunityTier.EXCELLENT: 1.5,
            OpportunityTier.GOOD: 1.2,
            OpportunityTier.DECENT: 1.0,
            OpportunityTier.SKIP: 0.5
        }
        
        multiplier = tier_multipliers.get(tier, 1.0)
        
        # Profit per millisecond * tier bonus
        score = (profit / execution_time_ms) * multiplier * 1000
        
        return score
    
    def _generate_reason(
        self,
        profit: float,
        spread_bps: float,
        slippage_pct: float,
        tier: OpportunityTier
    ) -> str:
        """Generate human-readable reason"""
        
        if profit >= self.min_profit_usd:
            return f"{tier.value} - ${profit:.2f} profit"
        elif profit > 0:
            return f"Profit too small (${profit:.2f} < ${self.min_profit_usd})"
        elif spread_bps < self.total_fee_bps:
            return f"Spread ({spread_bps:.0f} bps) < fees ({self.total_fee_bps} bps)"
        else:
            return f"Slippage ({slippage_pct:.2f}%) exceeds spread"
    
    def _create_batches(self, opportunities: List[SmartOpportunity]) -> List[List[SmartOpportunity]]:
        """
        Create execution batches
        
        Batching prevents system slowdown from too many concurrent transactions
        """
        
        batches = []
        for i in range(0, len(opportunities), self.batch_size):
            batch = opportunities[i:i + self.batch_size]
            batches.append(batch)
        
        return batches
    
    def _calculate_stats(
        self,
        all_opps: List[SmartOpportunity],
        viable: List[SmartOpportunity]
    ) -> Dict:
        """Calculate summary statistics"""
        
        if not viable:
            return {
                'total_scanned': len(all_opps),
                'total_viable': 0,
                'viable_rate': 0,
                'total_profit': 0,
                'avg_profit': 0,
                'best_profit': 0,
                'by_tier': {}
            }
        
        # Calculate totals
        total_profit = sum(o.expected_profit for o in viable)
        avg_profit = total_profit / len(viable)
        best_profit = max(o.expected_profit for o in viable)
        
        # Count by tier
        by_tier = {}
        for tier in OpportunityTier:
            count = len([o for o in viable if o.tier == tier])
            if count > 0:
                by_tier[tier.value] = count
        
        return {
            'total_scanned': len(all_opps),
            'total_viable': len(viable),
            'viable_rate': (len(viable) / len(all_opps) * 100) if all_opps else 0,
            'total_profit': total_profit,
            'avg_profit': avg_profit,
            'best_profit': best_profit,
            'by_tier': by_tier
        }


def demo_unified_optimizer():
    """Demonstrate the unified smart optimizer"""
    
    print("=" * 90)
    print("🎯 UNIFIED SMART OPTIMIZER - BEST OF ALL STRATEGIES")
    print("=" * 90)
    print()
    
    # Configuration
    config = {
        'min_profit_usd': 10.0,      # $10 minimum
        'max_slippage_pct': 0.5,     # 0.5% max slippage
        'max_pool_utilization': 0.01, # 1% max of pool
        'batch_size': 5               # Top 5 per batch
    }
    
    optimizer = UnifiedSmartOptimizer(config)
    
    print(f"⚙️  CONFIGURATION")
    print(f"-" * 90)
    print(f"Minimum Profit: ${config['min_profit_usd']}")
    print(f"Max Slippage: {config['max_slippage_pct']}%")
    print(f"Max Pool Use: {config['max_pool_utilization']*100}%")
    print(f"Batch Size: {config['batch_size']} opportunities")
    print()
    
    # Test markets (realistic scenarios)
    markets = [
        # Large established markets
        {'name': 'ETH/USDC (Uniswap)', 'spread_bps': 22, 'pool_liquidity': 100_000_000},
        {'name': 'ETH/USDC (Sushiswap)', 'spread_bps': 75, 'pool_liquidity': 50_000_000},
        {'name': 'WBTC/USDC', 'spread_bps': 80, 'pool_liquidity': 40_000_000},
        {'name': 'USDC/DAI (Curve)', 'spread_bps': 25, 'pool_liquidity': 150_000_000},
        
        # Medium markets
        {'name': 'LINK/USDC', 'spread_bps': 85, 'pool_liquidity': 10_000_000},
        {'name': 'UNI/USDC', 'spread_bps': 90, 'pool_liquidity': 8_000_000},
        {'name': 'AAVE/USDC', 'spread_bps': 95, 'pool_liquidity': 5_000_000},
        
        # Small/emerging markets
        {'name': 'ARB/USDC', 'spread_bps': 100, 'pool_liquidity': 2_000_000},
        {'name': 'OP/USDC', 'spread_bps': 110, 'pool_liquidity': 1_500_000},
        {'name': 'MATIC/USDC', 'spread_bps': 120, 'pool_liquidity': 1_000_000},
        
        # New tokens (wide spreads!)
        {'name': 'NEWTOKEN/USDC', 'spread_bps': 150, 'pool_liquidity': 500_000},
        {'name': 'MEME/USDC', 'spread_bps': 200, 'pool_liquidity': 100_000},
    ]
    
    # Scan markets
    results = optimizer.scan_markets(markets, gas_cost=2.0)
    
    # Display all opportunities
    print(f"📊 ALL OPPORTUNITIES SCANNED ({len(results['all_opportunities'])})")
    print(f"-" * 90)
    print(f"{'Pool':<25} {'Spread':<10} {'Loan':<15} {'Profit':<15} {'Tier':<15} {'Status'}")
    print(f"-" * 90)
    
    for opp in results['all_opportunities']:
        loan_str = f"${opp.loan_size:,.0f}" if opp.loan_size > 0 else "N/A"
        profit_str = f"${opp.expected_profit:.2f}" if opp.expected_profit >= 0 else f"-${abs(opp.expected_profit):.2f}"
        status = "✅" if opp.viable else "❌"
        
        print(f"{opp.pool_name:<25} {opp.spread_bps:>3.0f} bps   {loan_str:<15} {profit_str:<15} {opp.tier.value:<15} {status}")
    
    # Display viable opportunities
    viable = results['viable_opportunities']
    
    print(f"\n{'='*90}")
    print(f"✅ VIABLE OPPORTUNITIES ({len(viable)} found)")
    print(f"-" * 90)
    
    if viable:
        print(f"\n{'Pool':<25} {'Profit':<12} {'ROI%':<10} {'Priority':<12} {'Time':<10} {'$/sec'}")
        print(f"-" * 90)
        
        for opp in viable:
            print(f"{opp.pool_name:<25} ${opp.expected_profit:>9.2f}  {opp.roi_pct:>7.3f}%  {opp.priority_score:>10.2f}  {opp.execution_time_ms:>7.0f}ms  ${opp.profit_per_second:>8.2f}")
        
        # Show execution batches
        batches = results['execution_batches']
        
        print(f"\n{'='*90}")
        print(f"🚀 EXECUTION PLAN ({len(batches)} batches)")
        print(f"-" * 90)
        
        for i, batch in enumerate(batches, 1):
            batch_profit = sum(o.expected_profit for o in batch)
            batch_time = sum(o.execution_time_ms for o in batch)
            
            print(f"\nBatch {i}: {len(batch)} opportunities, ${batch_profit:.2f} profit, ~{batch_time:.0f}ms total")
            for j, opp in enumerate(batch, 1):
                print(f"  {j}. {opp.pool_name:<25} {opp.tier.value:<15} ${opp.expected_profit:.2f}")
        
        # Summary stats
        stats = results['summary_stats']
        
        print(f"\n{'='*90}")
        print(f"📈 SUMMARY STATISTICS")
        print(f"-" * 90)
        print(f"Total Markets Scanned: {stats['total_scanned']}")
        print(f"Viable Opportunities: {stats['total_viable']} ({stats['viable_rate']:.1f}%)")
        print(f"Total Potential Profit: ${stats['total_profit']:.2f}")
        print(f"Average Profit: ${stats['avg_profit']:.2f}")
        print(f"Best Opportunity: ${stats['best_profit']:.2f}")
        print(f"Scan Time: {results['scan_time_ms']:.2f}ms")
        
        if stats['by_tier']:
            print(f"\nBy Tier:")
            for tier, count in stats['by_tier'].items():
                print(f"  {tier}: {count}")
        
        # Daily projections
        print(f"\n{'='*90}")
        print(f"💰 DAILY PROFIT PROJECTIONS")
        print(f"-" * 90)
        
        print(f"\nAssuming you execute all {len(viable)} opportunities every cycle:\n")
        
        scenarios = [
            {'name': 'Conservative', 'cycles_per_day': 10},
            {'name': 'Moderate', 'cycles_per_day': 50},
            {'name': 'Aggressive', 'cycles_per_day': 100},
        ]
        
        print(f"{'Scenario':<20} {'Cycles/Day':<15} {'Daily':<15} {'Monthly':<15} {'Yearly'}")
        print(f"-" * 90)
        
        for scenario in scenarios:
            daily = stats['total_profit'] * scenario['cycles_per_day']
            monthly = daily * 30
            yearly = daily * 365
            
            print(f"{scenario['name']:<20} {scenario['cycles_per_day']:<15} ${daily:>13,.2f} ${monthly:>13,.2f} ${yearly:>14,.2f}")
    
    else:
        print("\nNo viable opportunities found with current settings.")
        print(f"Try lowering min_profit_usd or waiting for better market conditions.")
    
    # Key insights
    print(f"\n{'='*90}")
    print(f"💡 KEY INSIGHTS")
    print(f"-" * 90)
    print(f"""
1. SMART FILTERING:
   - Only shows opportunities with ${config['min_profit_usd']}+ profit
   - Guarantees <{config['max_slippage_pct']}% slippage on all trades
   - Avoids system slowdown with batching

2. PRIORITIZATION:
   - Sorts by profit/time ratio
   - Executes best opportunities first
   - Batches prevent concurrent overload

3. TIER CLASSIFICATION:
   💎 JACKPOT: $500+ (rare, huge profits)
   🏆 EXCELLENT: $100-500 (strong opportunities)
   ✅ GOOD: $50-100 (solid trades)
   👍 DECENT: $10-50 (volume strategy)

4. EXECUTION STRATEGY:
   - Batch size: {config['batch_size']} (prevents slowdown)
   - Execute top tier first
   - Gap between trades: {optimizer.min_execution_gap_ms}ms
   - Total time: ~{sum(o.execution_time_ms for o in viable) if viable else 0:.0f}ms for all

5. PROFIT OPTIMIZATION:
   - Each opportunity uses optimal loan size
   - Automatic safety limits
   - 2-5ms decision time per opportunity
   - Fast enough for high frequency

RECOMMENDED: Run scans every 10-30 seconds, execute top batches immediately!
""")


if __name__ == '__main__':
    demo_unified_optimizer()
