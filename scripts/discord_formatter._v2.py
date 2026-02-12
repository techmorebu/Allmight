#!/usr/bin/env python3
"""
Discord Formatter V2 - Enhanced with Terminal Mirror

Three channels:
1. #arbitrage-alerts - Top 5 opportunities (was 3)
2. #detailed-logs - Full statistics
3. #terminal-mirror - Complete terminal output
"""

import os
import sys
from typing import Dict, List, Optional
from datetime import datetime
from dataclasses import dataclass


@dataclass
class DiscordMessage:
    """Discord message with webhook routing"""
    webhook_type: str  # 'alert', 'detailed', or 'terminal'
    embed: Optional[Dict] = None
    content: Optional[str] = None  # For terminal mirror (plain text)


class DiscordFormatterV2:
    """
    Enhanced Discord formatter with 3 channels
    """
    
    def __init__(self):
        # Color codes
        self.colors = {
            'success': 0x00FF00,
            'warning': 0xFFA500,
            'error': 0xFF0000,
            'info': 0x0099FF,
            'jackpot': 0xFFD700,
            'excellent': 0x9B59B6,
            'good': 0x3498DB,
            'decent': 0x95A5A6,
            'terminal': 0x2C2F33  # Dark gray for terminal
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
        batch_size: int = 5  # Changed from 3 to 5
    ) -> DiscordMessage:
        """
        Create ALERT message showing TOP 5 opportunities
        """
        
        if not viable_opps:
            embed = {
                'title': '⏸️ No Opportunities',
                'description': 'No profitable opportunities detected',
                'color': self.colors['warning'],
                'timestamp': datetime.utcnow().isoformat(),
                'footer': {'text': 'Allmight Arbitrage Scanner'}
            }
            return DiscordMessage(webhook_type='alert', embed=embed)
        
        # Show top 5
        top_opps = viable_opps[:5]
        total_profit = sum(o.expected_profit for o in top_opps)
        
        # Determine color
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
        
        description = f"**{len(viable_opps)} opportunities** | **Top 5: ${total_profit:.2f}**"
        
        # Create fields for top 5
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
            'timestamp': datetime.utcnow().isoformat(),
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
        """
        
        description = (
            f"**Scanned:** {stats['total_scanned']} markets\n"
            f"**Viable:** {stats['total_viable']} ({stats['viable_rate']:.1f}%)\n"
            f"**Total Profit:** ${stats['total_profit']:.2f}\n"
            f"**Avg Profit:** ${stats['avg_profit']:.2f}\n"
            f"**Best:** ${stats['best_profit']:.2f}"
        )
        
        fields = []
        
        # By Tier
        if stats.get('by_tier'):
            tier_text = '\n'.join([f"{tier}: {count}" for tier, count in stats['by_tier'].items()])
            fields.append({
                'name': '📊 By Tier',
                'value': tier_text or 'None',
                'inline': True
            })
        
        # Execution plan
        if batches:
            batch_text = []
            for i, batch in enumerate(batches[:3], 1):
                batch_profit = sum(o.expected_profit for o in batch)
                batch_text.append(f"Batch {i}: {len(batch)} trades, ${batch_profit:.2f}")
            
            fields.append({
                'name': '🚀 Execution Plan',
                'value': '\n'.join(batch_text),
                'inline': True
            })
        
        # Top 5 opportunities (was top 3)
        if viable_opps:
            top_5 = viable_opps[:5]
            opp_text = []
            
            for i, opp in enumerate(top_5, 1):
                opp_text.append(
                    f"{i}. **{opp.pool_name}**\n"
                    f"   ${opp.expected_profit:.2f} | {opp.spread_bps:.0f}bps | ${opp.loan_size/1000:.0f}k loan"
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
        
        # Performance
        fields.append({
            'name': '⚡ Performance',
            'value': (
                f"Scan time: {stats.get('scan_time_ms', 0):.2f}ms\n"
                f"Avg decision: ~3ms\n"
                f"Total time: {sum(o.execution_time_ms for o in viable_opps) if viable_opps else 0:.0f}ms"
            ),
            'inline': True
        })
        
        embed = {
            'title': '📋 DETAILED SCAN REPORT',
            'description': description,
            'color': self.colors['info'],
            'fields': fields,
            'timestamp': datetime.utcnow().isoformat(),
            'footer': {'text': 'Allmight Arbitrage Scanner'}
        }
        
        return DiscordMessage(webhook_type='detailed', embed=embed)
    
    def create_terminal_mirror(
        self,
        scan_number: int,
        timestamp: str,
        markets_scanned: int,
        viable_count: int,
        total_count: int,
        viable_rate: float,
        scan_time_ms: float,
        top_opportunities: List = None,
        min_profit: float = 10.0
    ) -> DiscordMessage:
        """
        Create TERMINAL MIRROR message
        
        Mimics terminal output in Discord
        """
        
        # Build terminal-like message
        lines = [
            f"```",
            f"[Scan #{scan_number}] {timestamp}",
            f"━" * 60,
            f"🔍 ALLMIGHT ARBITRAGE SCAN",
            f"━" * 60,
            f"",
            f"📥 Markets Scanned: {markets_scanned}",
            f"⏱️  Scan Time: {scan_time_ms:.2f}ms",
            f"",
            f"📊 RESULTS:",
            f"   Total opportunities: {total_count}",
            f"   Viable opportunities: {viable_count}",
            f"   Viable rate: {viable_rate:.1f}%",
            f""
        ]
        
        if top_opportunities and len(top_opportunities) > 0:
            lines.append(f"🏆 TOP 5 OPPORTUNITIES:")
            for i, opp in enumerate(top_opportunities[:5], 1):
                lines.append(f"   {i}. {opp.pool_name}")
                lines.append(f"      💰 ${opp.expected_profit:.2f} profit")
                lines.append(f"      📊 {opp.spread_bps:.0f} bps | ${opp.loan_size:,.0f} loan")
                lines.append(f"      {opp.tier.value}")
        else:
            lines.append(f"⚠️  No viable opportunities found")
            lines.append(f"   Min profit threshold: ${min_profit}")
            lines.append(f"   Waiting for better market conditions...")
        
        lines.append(f"```")
        
        content = '\n'.join(lines)
        
        return DiscordMessage(webhook_type='terminal', content=content)


# Load environment
try:
    from dotenv import load_dotenv
    load_dotenv()
except:
    pass


def send_to_discord(message: DiscordMessage):
    """Send message to appropriate Discord webhook"""
    
    try:
        import requests
        
        # Get webhook URLs
        alert_webhook = os.getenv('DISCORD_ALERT_WEBHOOK')
        detailed_webhook = os.getenv('DISCORD_DETAILED_WEBHOOK')
        terminal_webhook = os.getenv('DISCORD_TERMINAL_WEBHOOK')
        
        # Determine which webhook to use
        if message.webhook_type == 'alert' and alert_webhook:
            webhook_url = alert_webhook
        elif message.webhook_type == 'detailed' and detailed_webhook:
            webhook_url = detailed_webhook
        elif message.webhook_type == 'terminal' and terminal_webhook:
            webhook_url = terminal_webhook
        else:
            return  # No webhook configured
        
        # Build payload
        if message.embed:
            payload = {'embeds': [message.embed]}
        elif message.content:
            payload = {'content': message.content}
        else:
            return
        
        # Send
        response = requests.post(webhook_url, json=payload, timeout=5)
        
        if response.status_code == 204:
            return True
        else:
            print(f"Discord webhook failed: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"Discord notification error: {e}")
        return False


if __name__ == '__main__':
    print("=" * 70)
    print("📱 DISCORD FORMATTER V2 - DEMO")
    print("=" * 70)
    print()
    print("New Features:")
    print("  ✅ Top 5 opportunities (was 3)")
    print("  ✅ Terminal mirror channel")
    print("  ✅ Enhanced formatting")
    print()
    print("Three Channels:")
    print("  1. #arbitrage-alerts → Quick actionable (top 5)")
    print("  2. #detailed-logs → Full statistics")
    print("  3. #terminal-mirror → Terminal output copy")
    print()
    print("Setup Instructions:")
    print("  1. Create #terminal-mirror channel in Discord")
    print("  2. Add webhook for it")
    print("  3. Add to .env:")
    print("     DISCORD_TERMINAL_WEBHOOK=https://discord.com/...")
    print()
