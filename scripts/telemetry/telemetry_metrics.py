#!/usr/bin/env python3
"""
Telemetry Metrics Analyzer - Compute metrics directly from JSONL

NO DATABASE REQUIRED - reads canonical JSONL files directly
All metrics reproducible from logs alone

Author: Allmight System  
Phase: 2.4.0 - Instrumentation
Governance: JSONL is canonical, this is derived
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Tuple
from collections import defaultdict
from datetime import datetime

logger = logging.getLogger('Allmight.MetricsAnalyzer')


class MetricsAnalyzer:
    """
    Compute execution metrics from JSONL telemetry
    
    All metrics are reproducible from JSONL alone - no hidden state
    """
    
    def __init__(self, telemetry_dir: Path):
        """
        Initialize analyzer
        
        Args:
            telemetry_dir: Path to data/telemetry/YYYYMMDD/
        """
        self.telemetry_dir = Path(telemetry_dir)
        
        # Raw data loaded from JSONL
        self.pipeline_events = []
        self.preflight_results = []
        self.bundle_sims = []
        
        logger.info(f"MetricsAnalyzer initialized for {telemetry_dir}")
    
    def load_data(self):
        """Load all JSONL files"""
        # Load pipeline events
        pipeline_file = self.telemetry_dir / "pipeline_events.jsonl"
        if pipeline_file.exists():
            self.pipeline_events = self._read_jsonl(pipeline_file)
            logger.info(f"Loaded {len(self.pipeline_events)} pipeline events")
        
        # Load preflight results
        preflight_file = self.telemetry_dir / "preflight_results.jsonl"
        if preflight_file.exists():
            self.preflight_results = self._read_jsonl(preflight_file)
            logger.info(f"Loaded {len(self.preflight_results)} preflight results")
            
            # Check for duplicates (governance check)
            self._check_duplicates()
        
        # Load bundle simulations (if exist)
        bundle_file = self.telemetry_dir / "bundle_sim_results.jsonl"
        if bundle_file.exists():
            self.bundle_sims = self._read_jsonl(bundle_file)
            logger.info(f"Loaded {len(self.bundle_sims)} bundle simulations")
    
    def _check_duplicates(self):
        """Check for duplicate preflight events per opportunity (governance)"""
        from collections import Counter
        
        opp_counts = Counter(r['opportunity_id'] for r in self.preflight_results)
        duplicates = {opp_id: count for opp_id, count in opp_counts.items() if count > 1}
        
        if duplicates:
            logger.warning(f"Found {len(duplicates)} opportunities with duplicate preflight events")
            for opp_id, count in list(duplicates.items())[:5]:  # Show first 5
                logger.warning(f"  {opp_id}: {count} preflight events (using latest ts_ms)")
    
    def _latest_by_opportunity(self, events: List[Dict]) -> List[Dict]:
        """
        Deduplicate events by opportunity_id, keeping latest by ts_ms
        
        Critical: prevents double-counting from retries/duplicates
        """
        latest = {}
        
        for event in events:
            opp_id = event.get('opportunity_id')
            ts_ms = event.get('ts_ms', 0)
            
            if opp_id not in latest or ts_ms > latest[opp_id].get('ts_ms', 0):
                latest[opp_id] = event
        
        return list(latest.values())
    
    def compute_preflight_filter_metrics(self) -> Dict:
        """
        Compute preflight filter metrics (NOT capture rate - that's later)
        
        Returns:
            {
                'detected_count': int,  # Unique opportunities
                'preflight_accept_any_count': int,  # ACCEPT_SIM_ONLY + ACCEPT_BUNDLE
                'preflight_accept_bundle_count': int,  # ACCEPT_BUNDLE only
                'preflight_reject_count': int,
                'rejection_rate': float,
                'accept_any_rate': float,
                'accept_bundle_rate': float
            }
        """
        # CRITICAL: Deduplicate by opportunity_id, use latest event
        latest_preflight = self._latest_by_opportunity(self.preflight_results)
        
        detected = len(latest_preflight)
        
        rejects = [r for r in latest_preflight if r['preflight_result'] == 'REJECT']
        accept_sim = [r for r in latest_preflight if r['preflight_result'] == 'ACCEPT_SIM_ONLY']
        accept_bundle = [r for r in latest_preflight if r['preflight_result'] == 'ACCEPT_BUNDLE']
        accept_any = accept_sim + accept_bundle
        
        return {
            'detected_count': detected,
            'preflight_reject_count': len(rejects),
            'preflight_accept_any_count': len(accept_any),
            'preflight_accept_bundle_count': len(accept_bundle),
            'rejection_rate': len(rejects) / detected if detected > 0 else 0.0,
            'accept_any_rate': len(accept_any) / detected if detected > 0 else 0.0,
            'accept_bundle_rate': len(accept_bundle) / detected if detected > 0 else 0.0
        }
    
    def compute_rejection_breakdown(self) -> Dict[str, int]:
        """
        Count rejections by reason code (deduplicated)
        
        Returns:
            {'REJ_CODE': count, ...}
        """
        # Use deduplicated preflight results
        latest_preflight = self._latest_by_opportunity(self.preflight_results)
        
        breakdown = defaultdict(int)
        
        for result in latest_preflight:
            if result['preflight_result'] == 'REJECT':
                code = result.get('rejection_reason_code', 'UNKNOWN')
                breakdown[code] += 1
        
        return dict(breakdown)
    
    def compute_stage_latencies(self) -> Dict[str, Dict]:
        """
        Compute average latency per stage (deduplicated)
        
        CRITICAL: Deduplicates by (opportunity_id, stage, stage_seq) to avoid
        double-counting retries
        
        Returns:
            {
                'STAGE_NAME': {
                    'count': int,
                    'avg_ms': float,
                    'min_ms': float,
                    'max_ms': float
                },
                ...
            }
        """
        # Deduplicate: keep latest event per (opportunity_id, stage, stage_seq)
        latest_stages = {}
        
        for event in sorted(self.pipeline_events, key=lambda e: e.get('ts_ms', 0)):
            if event.get('event_type') == 'PIPELINE_STAGE_END' and event.get('duration_ms') is not None:
                key = (
                    event.get('opportunity_id'),
                    event.get('stage'),
                    event.get('stage_seq', 0)
                )
                latest_stages[key] = event
        
        # Group by stage
        stage_durations = defaultdict(list)
        
        for event in latest_stages.values():
            stage = event['stage']
            duration = event['duration_ms']
            stage_durations[stage].append(duration)
        
        # Compute stats
        stats = {}
        for stage, durations in stage_durations.items():
            stats[stage] = {
                'count': len(durations),
                'avg_ms': sum(durations) / len(durations),
                'min_ms': min(durations),
                'max_ms': max(durations)
            }
        
        return stats
    
    def compute_edge_distribution(self) -> Dict:
        """
        Analyze net edge distribution (deduplicated)
        
        Returns:
            {
                'avg_net_edge_bps': float,
                'avg_safety_buffer_bps': float,
                'rejected_avg_edge': float,
                'accepted_avg_edge': float
            }
        """
        # Use deduplicated preflight results
        latest_preflight = self._latest_by_opportunity(self.preflight_results)
        
        all_edges = [r.get('net_edge_bps', 0) for r in latest_preflight]
        all_buffers = [r.get('safety_buffer_bps', 0) for r in latest_preflight]
        
        rejected = [r for r in latest_preflight if r['preflight_result'] == 'REJECT']
        accepted = [r for r in latest_preflight if r['preflight_result'] in ['ACCEPT_SIM_ONLY', 'ACCEPT_BUNDLE']]
        
        rejected_edges = [r.get('net_edge_bps', 0) for r in rejected]
        accepted_edges = [r.get('net_edge_bps', 0) for r in accepted]
        
        return {
            'avg_net_edge_bps': sum(all_edges) / len(all_edges) if all_edges else 0,
            'avg_safety_buffer_bps': sum(all_buffers) / len(all_buffers) if all_buffers else 0,
            'rejected_avg_edge_bps': sum(rejected_edges) / len(rejected_edges) if rejected_edges else 0,
            'accepted_avg_edge_bps': sum(accepted_edges) / len(accepted_edges) if accepted_edges else 0
        }
    
    def generate_report(self) -> str:
        """
        Generate human-readable metrics report
        
        Returns:
            Formatted report string
        """
        report = []
        report.append("=" * 80)
        report.append("📊 EXECUTION METRICS REPORT")
        report.append(f"Source: {self.telemetry_dir}")
        report.append("=" * 80)
        report.append("")
        
        # Preflight filter metrics (NOT capture - that's later)
        filter_metrics = self.compute_preflight_filter_metrics()
        report.append("🎯 PREFLIGHT FILTER METRICS:")
        report.append(f"   Unique opportunities detected: {filter_metrics['detected_count']}")
        report.append(f"   Preflight accepted (any): {filter_metrics['preflight_accept_any_count']} ({filter_metrics['accept_any_rate']:.1%})")
        report.append(f"   Preflight accepted (bundle-eligible): {filter_metrics['preflight_accept_bundle_count']} ({filter_metrics['accept_bundle_rate']:.1%})")
        report.append(f"   Preflight rejected: {filter_metrics['preflight_reject_count']} ({filter_metrics['rejection_rate']:.1%})")
        report.append("")
        
        # Rejection breakdown
        rejections = self.compute_rejection_breakdown()
        if rejections:
            report.append("❌ REJECTION BREAKDOWN:")
            for code, count in sorted(rejections.items(), key=lambda x: x[1], reverse=True):
                pct = (count / filter_metrics['detected_count']) * 100
                report.append(f"   {code}: {count} ({pct:.1f}%)")
            report.append("")
        
        # Stage latencies
        latencies = self.compute_stage_latencies()
        if latencies:
            report.append("⏱️  STAGE LATENCIES:")
            for stage, stats in sorted(latencies.items(), key=lambda x: x[1]['avg_ms'], reverse=True):
                report.append(
                    f"   {stage:20s}: avg={stats['avg_ms']:6.1f}ms  "
                    f"min={stats['min_ms']:5.0f}ms  max={stats['max_ms']:6.0f}ms  "
                    f"count={stats['count']}"
                )
            report.append("")
        
        # Edge distribution
        edge_dist = self.compute_edge_distribution()
        report.append("💰 EDGE DISTRIBUTION:")
        report.append(f"   Average net edge: {edge_dist['avg_net_edge_bps']:.2f} bps")
        report.append(f"   Average safety buffer: {edge_dist['avg_safety_buffer_bps']:.2f} bps")
        report.append(f"   Rejected avg edge: {edge_dist['rejected_avg_edge_bps']:.2f} bps")
        report.append(f"   Accepted avg edge: {edge_dist['accepted_avg_edge_bps']:.2f} bps")
        report.append("")
        
        # Expansion gate status (placeholder - need execution data)
        report.append("🚪 EXPANSION GATE STATUS:")
        report.append("   [Not yet available - need INCLUSION_RESULT events]")
        report.append("   Required:")
        report.append("     - Capture rate ≥60% (profitable_included / detected)")
        report.append("     - Revert rate ≤10% (reverted / included)")
        report.append("     - Gas coverage ≥1.5x (gross_profit / gas_cost)")
        report.append("     - Consecutive wins ≥30 (profitable included executions only)")
        report.append("")
        
        report.append("=" * 80)
        report.append("📝 GOVERNANCE NOTES:")
        report.append("    - All metrics computed from canonical JSONL files")
        report.append("    - No database required - fully reproducible from logs")
        report.append("    - Duplicates deduplicated by (opportunity_id, ts_ms)")
        report.append("    - Stage latencies deduped by (opportunity_id, stage, stage_seq)")
        report.append("    - 'Capture rate' refers to execution outcomes, not preflight")
        report.append("=" * 80)
        
        return "\n".join(report)
    
    def _read_jsonl(self, file_path: Path) -> List[Dict]:
        """
        Read JSONL file with error handling
        
        Catches JSON decode errors and logs line numbers
        """
        events = []
        
        with open(file_path, 'r') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if line:
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError as e:
                        logger.warning(f"Corrupt JSON at {file_path}:{line_num} - {e}")
                        continue
        
        return events


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Analyze telemetry metrics from JSONL')
    parser.add_argument('--dir', required=True, help='Telemetry directory (e.g., data/telemetry/20260214)')
    parser.add_argument('--output', help='Save report to file')
    
    args = parser.parse_args()
    
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format='[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Analyze
    analyzer = MetricsAnalyzer(args.dir)
    analyzer.load_data()
    
    report = analyzer.generate_report()
    
    # Print report
    print(report)
    
    # Save if requested
    if args.output:
        with open(args.output, 'w') as f:
            f.write(report)
        print(f"\n✅ Report saved to {args.output}")


if __name__ == '__main__':
    main()
