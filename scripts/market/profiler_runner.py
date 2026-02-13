#!/usr/bin/env python3
"""
Profiler Runner - Analyzes collected snapshots and generates expansion report

Usage:
    1. Collect snapshots: python snapshot_collector.py --mode continuous --duration 60
    2. Analyze: python profiler_runner.py
    3. Read report to decide expansion strategy

Author: Allmight System
Phase: 2.3A - Market Inefficiency Profiler
"""

import sys
import os
import logging
from datetime import datetime, timedelta
from typing import List, Dict
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from market_storage import MarketStorage
from market_profiler import MarketInefficacyProfiler, MarketProfile

logger = logging.getLogger('Allmight.ProfilerRunner')


class ProfilerRunner:
    """
    Runs the full profiling analysis
    
    1. Loads snapshots from storage
    2. Groups by market
    3. Profiles each market
    4. Generates report
    5. Saves results
    """
    
    def __init__(self, data_dir: str = "data/snapshots"):
        self.storage = MarketStorage(data_dir)
        self.profiler = MarketInefficacyProfiler()
        logger.info("ProfilerRunner initialized")
    
    def analyze_recent(self, hours: int = 1) -> List[MarketProfile]:
        """
        Analyze recent snapshots
        
        Args:
            hours: How many hours of data to analyze
        
        Returns:
            List of MarketProfile objects
        """
        logger.info(f"Analyzing last {hours} hour(s) of data...")
        
        # Get list of all markets
        markets = self.storage.list_markets()
        
        if not markets:
            logger.warning("No markets found in storage")
            return []
        
        logger.info(f"Found {len(markets)} markets in storage")
        
        # Load snapshots for each market
        profiles = []
        
        for market_info in markets:
            chain_id = market_info['chain_id']
            venue_id = market_info['venue_id']
            market_id = market_info['market_id']
            
            try:
                # Load recent snapshots
                snapshots = self._load_recent_snapshots(
                    chain_id, venue_id, market_id, hours
                )
                
                if not snapshots:
                    logger.warning(f"No snapshots for {venue_id} {market_id}")
                    continue
                
                if len(snapshots) < 5:
                    logger.warning(f"Too few snapshots for {venue_id} {market_id} ({len(snapshots)})")
                    continue
                
                # Profile this market
                profile = self.profiler.profile_market(snapshots)
                profiles.append(profile)
                
                logger.info(f"Profiled {venue_id} {market_id}: EdgeScore {profile.edge_score:.1f}")
                
            except Exception as e:
                logger.error(f"Failed to profile {venue_id} {market_id}: {e}")
        
        logger.info(f"Successfully profiled {len(profiles)} markets")
        
        return profiles
    
    def _load_recent_snapshots(
        self,
        chain_id: str,
        venue_id: str,
        market_id: str,
        hours: int
    ):
        """Load snapshots from recent hours"""
        # Calculate date range
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(hours=hours)
        
        # Load snapshots
        snapshots = self.storage.read_range(
            chain_id,
            venue_id,
            market_id,
            start_date.strftime('%Y-%m-%d'),
            end_date.strftime('%Y-%m-%d')
        )
        
        # Filter to time range
        start_ts = int(start_date.timestamp() * 1000)
        end_ts = int(end_date.timestamp() * 1000)
        
        snapshots = [
            s for s in snapshots
            if start_ts <= s.ts_ms <= end_ts
        ]
        
        return snapshots
    
    def generate_report(
        self,
        profiles: List[MarketProfile],
        output_file: Optional[str] = None
    ) -> str:
        """
        Generate and optionally save report
        
        Args:
            profiles: List of MarketProfile objects
            output_file: Path to save report (optional)
        
        Returns:
            Report text
        """
        report = self.profiler.generate_report(profiles)
        
        if output_file:
            with open(output_file, 'w') as f:
                f.write(report)
            logger.info(f"Report saved to {output_file}")
        
        return report
    
    def get_expansion_decision(self, profiles: List[MarketProfile]) -> Dict:
        """
        Generate machine-readable expansion decision
        
        Returns:
            {
                'should_expand': bool,
                'expand_to': List[str],  # Chains to expand to
                'focus_pairs': List[str],  # Pairs to prioritize
                'reason': str
            }
        """
        strong = [p for p in profiles if p.status == "STRONG"]
        viable = [p for p in profiles if p.status == "VIABLE"]
        
        decision = {
            'should_expand': False,
            'expand_to': [],
            'focus_pairs': [],
            'reason': ''
        }
        
        if len(strong) >= 3:
            decision['should_expand'] = True
            decision['expand_to'] = ['base', 'arbitrum', 'avalanche']
            decision['focus_pairs'] = [p.pair for p in strong]
            decision['reason'] = f"Found {len(strong)} STRONG markets - excellent edge exists"
        
        elif len(strong) + len(viable) >= 3:
            decision['should_expand'] = True
            decision['expand_to'] = ['base', 'arbitrum']
            decision['focus_pairs'] = [p.pair for p in strong + viable]
            decision['reason'] = f"Found {len(strong)} STRONG + {len(viable)} VIABLE markets - proceed cautiously"
        
        elif len(viable) >= 1:
            decision['should_expand'] = False
            decision['reason'] = "Only marginal edge - optimize execution before expansion"
        
        else:
            decision['should_expand'] = False
            decision['reason'] = "No exploitable edge found - focus on execution layer, not expansion"
        
        return decision


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Allmight Market Inefficiency Profiler')
    parser.add_argument('--hours', type=int, default=1, help='Hours of data to analyze')
    parser.add_argument('--data-dir', default='data/snapshots', help='Snapshot storage directory')
    parser.add_argument('--output', help='Save report to file')
    parser.add_argument('--json', action='store_true', help='Output decision as JSON')
    
    args = parser.parse_args()
    
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Run analysis
    runner = ProfilerRunner(args.data_dir)
    
    profiles = runner.analyze_recent(args.hours)
    
    if not profiles:
        print("\n❌ No profiles generated. Make sure you've collected snapshots first:")
        print("   python snapshot_collector.py --mode continuous --duration 60")
        return
    
    # Generate report
    report = runner.generate_report(profiles, args.output)
    
    # Print report
    print("\n" + report)
    
    # Generate decision
    decision = runner.get_expansion_decision(profiles)
    
    print("\n")
    print("=" * 120)
    print("🎯 EXPANSION DECISION")
    print("=" * 120)
    print()
    
    if decision['should_expand']:
        print(f"✅ EXPAND: {decision['reason']}")
        print(f"   Target chains: {', '.join(decision['expand_to'])}")
        print(f"   Focus pairs: {', '.join(decision['focus_pairs'])}")
    else:
        print(f"❌ DO NOT EXPAND: {decision['reason']}")
    
    print()
    
    if args.json:
        import json
        print(json.dumps(decision, indent=2))


if __name__ == '__main__':
    main()
