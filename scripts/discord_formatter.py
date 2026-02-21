#!/usr/bin/env python3
"""
Discord Notification Formatter
Creates clean, actionable Discord messages for arbitrage opportunities

Two channels:
1. #alerts - Quick actionable summaries (execute now!)
2. #detailed-logs - Full analysis and statistics
"""

from typing import Dict, List, Optional
from datetime import datetime, timezone
from dataclasses import dataclass


@dataclass
class DiscordMessage:
    """Discord message with webhook routing"""
    webhook_type: str  # 'alert' or 'detailed'
    embed: Dict
    

class DiscordFormatter:
    """
    Format arbitrage results for Discord
    
    Creates two types of messages:
    - ALERTS: Clean, actionable (top opportunities only)
    - DETAILED: Full statistics and analysis
    """
    
    def __init__(self):
        # Color codes
        self.colors = {
            'success': 0x00FF00,    # Green
            'warning': 0xFFA500,    # Orange
            'error': 0xFF0000,      # Red
            'info': 0x0099FF,       # Blue
            'jackpot': 0xFFD700,    # Gold
            'excellent': 0x9B59B6,  # Purple
            'good': 0x3498DB,       # Blue
            'decent': 0x95A5A6      # Gray
        }
        
        # Tier emojis
        self.tier_emojis = {
            '💎 JACKPOT': '💎',
            '🏆 EXCELLENT': '🏆',
            '✅ GOOD': '✅',
            '👍 DECENT': '👍',
            '⏭️ SKIP': '⏭️'
        }
    
    def create_alert_message(
        self,
        viable_opps: List,
        stats: Dict,
        batch_size: int = 3
    ) -> DiscordMessage:
        """
        Create QUICK ALERT message
        
        Shows only top opportunities - clean and actionable
        Perfect for #alerts channel
        """
        
        if not viable_opps:
            # No opportunities
            embed = {
                'title': '⏸️ No Opportunities',
                'description': 'No profitable opportunities detected',
                'color': self.colors['warning'],
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'footer': {'text': 'Allmight Arbitrage Scanner'}
            }
            
            return DiscordMessage(webhook_type='alert', embed=embed)
        
        # Show top N opportunities
        top_opps = viable_opps[:batch_size]
        total_profit = sum(o.expected_profit for o in top_opps)
        
        # Determine color based on best opportunity
        best_profit = top_opps[0].expected_profit
        if best_profit >= 500:
            color = self.colors['jackpot']
            alert_emoji = '💎'
        elif best_profit >= 100:
            color = self.colors['excellent']
            alert_emoji = '🏆'
        elif best_profit >= 50:
            color = self.colors['good']
            alert_emoji = '✅'
        else:
            color = self.colors['decent']
            alert_emoji = '👍'
        
        # Create description
        description = f"**{len(viable_opps)} opportunities** | **Top {len(top_opps)}: ${total_profit:.2f}**"
        
        # Create fields for each opportunity
        fields = []
        
        for i, opp in enumerate(top_opps, 1):
            emoji = self.tier_emojis.get(opp.tier.value, '•')
            
            field_value = (
                f"💰 **${opp.expected_profit:.2f}** profit\n"
                f"💵 ${opp.loan_size:,.0f} loan\n"
                f"📊 {opp.spread_bps:.0f} bps spread"
            )
            
            fields.append({
                'name': f"{emoji} #{i} {opp.pool_name}",
                'value': field_value,
                'inline': True
            })
        
        # Add execution time
        total_time = sum(o.execution_time_ms for o in top_opps)
        
        fields.append({
            'name': '⚡ Execution',
            'value': f"~{total_time:.0f}ms total\n{len(top_opps)} trades batched",
            'inline': True
        })
        
        embed = {
            'title': f'{alert_emoji} ARBITRAGE OPPORTUNITY DETECTED',
            'description': description,
            'color': color,
            'fields': fields,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'footer': {'text': f'Scan time: {stats.get("scan_time_ms", 0):.2f}ms'}
        }
        
        return DiscordMessage(webhook_type='alert', embed=embed)
    
    def create_detailed_message(
        self,
        all_opps: List,
        viable_opps: List,
        stats: Dict,
        batches: List
    ) -> DiscordMessage:
        """
        Create DETAILED LOG message
        
        Full statistics and analysis
        Perfect for #detailed-logs channel
        """
        
        # Summary statistics
        description = (
            f"**Scanned:** {stats['total_scanned']} markets\n"
            f"**Viable:** {stats['total_viable']} ({stats['viable_rate']:.1f}%)\n"
            f"**Total Profit:** ${stats['total_profit']:.2f}\n"
            f"**Avg Profit:** ${stats['avg_profit']:.2f}\n"
            f"**Best:** ${stats['best_profit']:.2f}"
        )
        
        fields = []
        
        # By Tier breakdown
        if stats.get('by_tier'):
            tier_text = '\n'.join([
                f"{tier}: {count}"
                for tier, count in stats['by_tier'].items()
            ])
            
            fields.append({
                'name': '📊 By Tier',
                'value': tier_text or 'None',
                'inline': True
            })
        
        # Execution plan
        if batches:
            batch_text = []
            for i, batch in enumerate(batches[:3], 1):  # Show first 3 batches
                batch_profit = sum(o.expected_profit for o in batch)
                batch_text.append(f"Batch {i}: {len(batch)} trades, ${batch_profit:.2f}")
            
            fields.append({
                'name': '🚀 Execution Plan',
                'value': '\n'.join(batch_text),
                'inline': True
            })
        
        # Top opportunities (detailed)
        if viable_opps:
            top_5 = viable_opps[:5]
            opp_text = []
            
            for i, opp in enumerate(top_5, 1):
                opp_text.append(
                    f"{i}. **{opp.pool_name}**\n"
                    f"   ${opp.expected_profit:.2f} | "
                    f"{opp.spread_bps:.0f}bps | "
                    f"${opp.loan_size/1000:.0f}k loan"
                )
            
            fields.append({
                'name': '🏆 Top 5 Opportunities',
                'value': '\n'.join(opp_text),
                'inline': False
            })
        
        # Daily projections
        if viable_opps:
            daily_conservative = stats['total_profit'] * 10
            daily_moderate = stats['total_profit'] * 50
            
            fields.append({
                'name': '💰 Daily Projections',
                'value': (
                    f"Conservative (10x): ${daily_conservative:,.2f}\n"
                    f"Moderate (50x): ${daily_moderate:,.2f}"
                ),
                'inline': True
            })
        
        # Performance metrics
        fields.append({
            'name': '⚡ Performance',
            'value': (
                f"Scan time: {stats.get('scan_time_ms', 0):.2f}ms\n"
                f"Avg decision: ~3ms\n"
                f"Total viable time: {sum(o.execution_time_ms for o in viable_opps) if viable_opps else 0:.0f}ms"
            ),
            'inline': True
        })
        
        embed = {
            'title': '📋 DETAILED SCAN REPORT',
            'description': description,
            'color': self.colors['info'],
            'fields': fields,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'footer': {'text': 'Allmight Arbitrage Scanner - Full Report'}
        }
        
        return DiscordMessage(webhook_type='detailed', embed=embed)
    
    def create_execution_result(
        self,
        pool_name: str,
        profit: float,
        tx_hash: str,
        success: bool,
        execution_time_ms: float
    ) -> DiscordMessage:
        """
        Create EXECUTION RESULT message
        
        Posted after trade execution
        """
        
        if success:
            embed = {
                'title': '✅ TRADE EXECUTED SUCCESSFULLY',
                'description': f"**{pool_name}**",
                'color': self.colors['success'],
                'fields': [
                    {
                        'name': '💰 Profit',
                        'value': f"${profit:.2f}",
                        'inline': True
                    },
                    {
                        'name': '⏱️ Time',
                        'value': f"{execution_time_ms:.0f}ms",
                        'inline': True
                    },
                    {
                        'name': '🔗 Transaction',
                        'value': f"[View on Etherscan](https://etherscan.io/tx/{tx_hash})",
                        'inline': False
                    }
                ],
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'footer': {'text': 'Allmight Execution'}
            }
        else:
            embed = {
                'title': '❌ TRADE FAILED',
                'description': f"**{pool_name}**",
                'color': self.colors['error'],
                'fields': [
                    {
                        'name': '💰 Expected Profit',
                        'value': f"${profit:.2f}",
                        'inline': True
                    },
                    {
                        'name': '🔗 Transaction',
                        'value': f"[View on Etherscan](https://etherscan.io/tx/{tx_hash})",
                        'inline': False
                    }
                ],
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'footer': {'text': 'Allmight Execution'}
            }
        
        return DiscordMessage(webhook_type='alert', embed=embed)
    
    def create_daily_summary(
        self,
        total_scans: int,
        total_opportunities: int,
        total_executed: int,
        total_profit: float,
        success_rate: float
    ) -> DiscordMessage:
        """
        Create DAILY SUMMARY message
        
        Posted at end of day
        """
        
        embed = {
            'title': '📊 DAILY SUMMARY',
            'description': f"**{datetime.now().strftime('%B %d, %Y')}**",
            'color': self.colors['info'],
            'fields': [
                {
                    'name': '🔍 Scans',
                    'value': f"{total_scans:,}",
                    'inline': True
                },
                {
                    'name': '🎯 Opportunities',
                    'value': f"{total_opportunities:,}",
                    'inline': True
                },
                {
                    'name': '✅ Executed',
                    'value': f"{total_executed:,}",
                    'inline': True
                },
                {
                    'name': '💰 Total Profit',
                    'value': f"${total_profit:,.2f}",
                    'inline': True
                },
                {
                    'name': '📈 Success Rate',
                    'value': f"{success_rate:.1f}%",
                    'inline': True
                },
                {
                    'name': '💵 Avg per Trade',
                    'value': f"${total_profit/total_executed:.2f}" if total_executed > 0 else "N/A",
                    'inline': True
                }
            ],
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'footer': {'text': 'Allmight Daily Summary'}
        }
        
        return DiscordMessage(webhook_type='detailed', embed=embed)


def demo_discord_formatter():
    """Demonstrate Discord formatting"""
    
    print("=" * 80)
    print("💬 DISCORD NOTIFICATION FORMATTER DEMO")
    print("=" * 80)
    print()
    
    # Mock data (from unified optimizer results)
    from dataclasses import dataclass
    from enum import Enum
    
    class OpportunityTier(Enum):
        JACKPOT = "💎 JACKPOT"
        EXCELLENT = "🏆 EXCELLENT"
        GOOD = "✅ GOOD"
        DECENT = "👍 DECENT"
        SKIP = "⏭️ SKIP"
    
    @dataclass
    class MockOpp:
        pool_name: str
        expected_profit: float
        loan_size: float
        spread_bps: float
        tier: OpportunityTier
        execution_time_ms: float
    
    # Create mock opportunities
    viable_opps = [
        MockOpp("OP/USDC", 129.50, 15000, 110, OpportunityTier.EXCELLENT, 150),
        MockOpp("MATIC/USDC", 89.00, 10000, 120, OpportunityTier.GOOD, 150),
        MockOpp("NEWTOKEN/USDC", 78.50, 5000, 150, OpportunityTier.GOOD, 150),
        MockOpp("AAVE/USDC", 28.00, 50000, 95, OpportunityTier.DECENT, 100),
        MockOpp("WBTC/USDC", 25.34, 250440, 80, OpportunityTier.DECENT, 100),
        MockOpp("ARB/USDC", 20.00, 20000, 100, OpportunityTier.DECENT, 100),
    ]
    
    stats = {
        'total_scanned': 12,
        'total_viable': 6,
        'viable_rate': 50.0,
        'total_profit': 370.34,
        'avg_profit': 61.72,
        'best_profit': 129.50,
        'scan_time_ms': 2.45,
        'by_tier': {
            '🏆 EXCELLENT': 1,
            '✅ GOOD': 2,
            '👍 DECENT': 3
        }
    }
    
    batches = [
        viable_opps[:3],
        viable_opps[3:]
    ]
    
    formatter = DiscordFormatter()
    
    # Create alert message
    print("📢 ALERT MESSAGE (#alerts channel)")
    print("-" * 80)
    
    alert = formatter.create_alert_message(viable_opps, stats, batch_size=3)
    
    print(f"Webhook: {alert.webhook_type}")
    print(f"Title: {alert.embed['title']}")
    print(f"Description: {alert.embed['description']}")
    print(f"\nFields:")
    for field in alert.embed['fields']:
        print(f"  {field['name']}:")
        print(f"    {field['value']}")
    print()
    
    # Create detailed message
    print("📋 DETAILED MESSAGE (#detailed-logs channel)")
    print("-" * 80)
    
    detailed = formatter.create_detailed_message([], viable_opps, stats, batches)
    
    print(f"Webhook: {detailed.webhook_type}")
    print(f"Title: {detailed.embed['title']}")
    print(f"Description: {detailed.embed['description']}")
    print(f"\nFields:")
    for field in detailed.embed['fields']:
        print(f"  {field['name']}:")
        if '\n' in field.get('value', ''):
            for line in field['value'].split('\n'):
                print(f"    {line}")
        else:
            print(f"    {field['value']}")
    print()
    
    # Create execution result
    print("✅ EXECUTION RESULT (#alerts channel)")
    print("-" * 80)
    
    execution = formatter.create_execution_result(
        pool_name="OP/USDC",
        profit=129.50,
        tx_hash="0x1234567890abcdef",
        success=True,
        execution_time_ms=187
    )
    
    print(f"Title: {execution.embed['title']}")
    print(f"Fields:")
    for field in execution.embed['fields']:
        print(f"  {field['name']}: {field['value']}")
    print()
    
    # Create daily summary
    print("📊 DAILY SUMMARY (#detailed-logs channel)")
    print("-" * 80)
    
    summary = formatter.create_daily_summary(
        total_scans=288,
        total_opportunities=156,
        total_executed=89,
        total_profit=4523.67,
        success_rate=92.1
    )
    
    print(f"Title: {summary.embed['title']}")
    print(f"Fields:")
    for field in summary.embed['fields']:
        print(f"  {field['name']}: {field['value']}")
    print()
    
    # Show JSON for actual Discord webhook
    print("=" * 80)
    print("📤 EXAMPLE DISCORD WEBHOOK PAYLOAD")
    print("-" * 80)
    print()
    print("POST to Discord webhook URL:")
    print()
    
    import json
    payload = {
        'embeds': [alert.embed]
    }
    
    print(json.dumps(payload, indent=2))
    print()
    
    print("=" * 80)
    print("💡 DISCORD CHANNEL SETUP")
    print("-" * 80)
    print("""
RECOMMENDED SETUP:

1️⃣ #arbitrage-alerts (ALERT webhook)
   - Quick actionable notifications
   - Top 3 opportunities only
   - Clean and urgent
   - Mobile notifications ON
   
2️⃣ #detailed-logs (DETAILED webhook)
   - Full statistics
   - All opportunities
   - Performance metrics
   - Daily summaries
   - Mobile notifications OFF (too noisy)

3️⃣ #execution-results (ALERT webhook)
   - Trade execution confirmations
   - Success/failure status
   - Transaction links
   - Profit tracking

WEBHOOK CONFIGURATION:
1. Go to Discord channel settings
2. Integrations → Webhooks → New Webhook
3. Copy webhook URL
4. Add to .env:
   DISCORD_ALERT_WEBHOOK=<alerts_webhook>
   DISCORD_DETAILED_WEBHOOK=<detailed_webhook>

NOTIFICATION FREQUENCY:
- Alerts: Only when viable opportunities (immediate action)
- Detailed: Every scan (every 10-30 seconds)
- Execution: After each trade
- Summary: Once per day (end of day)

This keeps your #alerts channel clean and actionable while
#detailed-logs has everything for analysis!
""")


if __name__ == '__main__':
    demo_discord_formatter()
