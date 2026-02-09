// utils/discord_notifier.js
// Discord Webhook Notification System
// Sends alerts for opportunities, errors, and system events

require('dotenv').config();
const fetch = require('node-fetch');

/**
 * Discord Notifier
 * 
 * Sends formatted notifications to Discord webhooks
 * Supports multiple webhook URLs for different alert types
 */
class DiscordNotifier {
  constructor() {
    // Load webhook URLs from environment
    this.webhooks = {
      opportunities: process.env.DISCORD_PROFIT_WEBHOOK_URL,
      errors: process.env.DISCORD_WEBHOOK_URL,
      general: process.env.DISCORD_WEBHOOK_URL
    };
    
    // Notification settings
    this.enabled = process.env.DISCORD_NOTIFICATIONS_ENABLED !== 'false';
    this.minProfitForAlert = parseFloat(process.env.MIN_PROFIT_ALERT_USD || 100);
    
    // Rate limiting (prevent spam)
    this.lastNotificationTime = {};
    this.minIntervalMs = 60000; // 1 minute between similar notifications
    
    // Statistics
    this.stats = {
      sent: 0,
      failed: 0,
      ratelimited: 0
    };
  }
  
  /**
   * Send opportunity notification
   */
  async notifyOpportunity(opportunity, scanStats) {
    if (!this.enabled) return;
    
    const profit = opportunity.profit?.net_usd || 0;
    
    // Only notify if profit exceeds threshold
    if (profit < this.minProfitForAlert) {
      return;
    }
    
    // Rate limit opportunity notifications
    if (this._isRateLimited('opportunity')) {
      this.stats.ratelimited++;
      return;
    }
    
    const embed = {
      title: '🎯 Profitable Arbitrage Opportunity Detected',
      description: `**${opportunity.type?.toUpperCase()}**\n${opportunity.strategy}`,
      color: this._getProfitColor(profit),
      fields: [
        {
          name: '💰 Net Profit',
          value: `$${profit.toFixed(2)} (${opportunity.profit?.net_bps?.toFixed(2)} bps)`,
          inline: true
        },
        {
          name: '⛽ Gas Cost',
          value: `$${opportunity.profit?.gas_cost_usd?.toFixed(2)}`,
          inline: true
        },
        {
          name: '📊 Gross Profit',
          value: `$${opportunity.profit?.gross_usd?.toFixed(2)}`,
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: `Scan #${scanStats?.total_scans || 'N/A'} | Viability: ${scanStats?.viable_percentage || 'N/A'}%`
      }
    };
    
    // Add type-specific details
    if (opportunity.type === 'cross_dex') {
      embed.fields.push({
        name: '🔄 Route',
        value: `Buy: ${opportunity.buy_exchange}\nSell: ${opportunity.sell_exchange}`,
        inline: true
      });
      
      if (opportunity.pair) {
        embed.fields.push({
          name: '💱 Pair',
          value: opportunity.pair,
          inline: true
        });
      }
    } else if (opportunity.type === 'triangle') {
      embed.fields.push({
        name: '🔺 Path',
        value: opportunity.path?.join(' → ') || 'N/A',
        inline: false
      });
    } else if (opportunity.type === 'stablecoin_depeg') {
      embed.fields.push({
        name: '🪙 Coin',
        value: opportunity.coin || 'N/A',
        inline: true
      });
      embed.fields.push({
        name: '📉 Deviation',
        value: `${opportunity.deviation?.percentage?.toFixed(3)}%`,
        inline: true
      });
    }
    
    // Add recommended size
    if (opportunity.recommended_trade_size) {
      const size = opportunity.recommended_trade_size;
      embed.fields.push({
        name: '💵 Recommended Size',
        value: `$${size.recommended_usd?.toFixed(0) || size.recommended_eth?.toFixed(2) + ' ETH'}`,
        inline: true
      });
    }
    
    await this._sendWebhook(this.webhooks.opportunities, {
      username: 'Allmight Arbitrage Bot',
      avatar_url: 'https://i.imgur.com/4M34hi2.png', // Optional: add bot avatar
      embeds: [embed]
    });
  }
  
  /**
   * Send error notification
   */
  async notifyError(error, context = {}) {
    if (!this.enabled) return;
    
    // Rate limit error notifications (same error type)
    const errorKey = `error_${error.name || 'unknown'}`;
    if (this._isRateLimited(errorKey)) {
      this.stats.ratelimited++;
      return;
    }
    
    const embed = {
      title: '❌ System Error Detected',
      description: `\`\`\`${error.message || 'Unknown error'}\`\`\``,
      color: 0xFF0000, // Red
      fields: [
        {
          name: '📍 Location',
          value: context.component || 'Unknown',
          inline: true
        },
        {
          name: '⏰ Time',
          value: new Date().toLocaleString(),
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };
    
    // Add error details
    if (error.name) {
      embed.fields.push({
        name: 'Error Type',
        value: error.name,
        inline: true
      });
    }
    
    if (error.stack && context.includeStack) {
      embed.fields.push({
        name: '📜 Stack Trace',
        value: `\`\`\`${error.stack.substring(0, 1000)}\`\`\``,
        inline: false
      });
    }
    
    // Add context data
    if (Object.keys(context).length > 0) {
      const contextStr = Object.entries(context)
        .filter(([key]) => !['component', 'includeStack'].includes(key))
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join('\n');
      
      if (contextStr) {
        embed.fields.push({
          name: '🔍 Context',
          value: `\`\`\`${contextStr.substring(0, 1000)}\`\`\``,
          inline: false
        });
      }
    }
    
    await this._sendWebhook(this.webhooks.errors, {
      username: 'Allmight Error Reporter',
      embeds: [embed]
    });
  }
  
  /**
   * Send system status notification
   */
  async notifyStatus(status, stats = {}) {
    if (!this.enabled) return;
    
    const statusEmoji = {
      'started': '🚀',
      'stopped': '🛑',
      'healthy': '✅',
      'degraded': '⚠️',
      'error': '❌'
    };
    
    const statusColor = {
      'started': 0x00FF00,  // Green
      'stopped': 0x808080,  // Gray
      'healthy': 0x00FF00,  // Green
      'degraded': 0xFFA500, // Orange
      'error': 0xFF0000     // Red
    };
    
    const embed = {
      title: `${statusEmoji[status] || '📊'} System Status: ${status.toUpperCase()}`,
      color: statusColor[status] || 0x0099FF,
      fields: [],
      timestamp: new Date().toISOString()
    };
    
    // Add statistics if provided
    if (stats.uptime) {
      embed.fields.push({
        name: '⏱️ Uptime',
        value: this._formatUptime(stats.uptime),
        inline: true
      });
    }
    
    if (stats.total_scans !== undefined) {
      embed.fields.push({
        name: '🔍 Total Scans',
        value: stats.total_scans.toString(),
        inline: true
      });
    }
    
    if (stats.opportunities_found !== undefined) {
      embed.fields.push({
        name: '🎯 Opportunities Found',
        value: stats.opportunities_found.toString(),
        inline: true
      });
    }
    
    if (stats.best_profit_usd !== undefined && stats.best_profit_usd > 0) {
      embed.fields.push({
        name: '💰 Best Profit',
        value: `$${stats.best_profit_usd.toFixed(2)}`,
        inline: true
      });
    }
    
    if (stats.network_state) {
      embed.fields.push({
        name: '🌐 Network',
        value: stats.network_state,
        inline: true
      });
    }
    
    if (stats.gas_price) {
      embed.fields.push({
        name: '⛽ Gas Price',
        value: `${stats.gas_price} gwei`,
        inline: true
      });
    }
    
    await this._sendWebhook(this.webhooks.general, {
      username: 'Allmight Status',
      embeds: [embed]
    });
  }
  
  /**
   * Send daily summary
   */
  async notifyDailySummary(summary) {
    if (!this.enabled) return;
    
    const embed = {
      title: '📊 Daily Summary Report',
      color: 0x0099FF,
      fields: [
        {
          name: '🔍 Total Scans',
          value: summary.total_scans?.toString() || '0',
          inline: true
        },
        {
          name: '🎯 Opportunities Found',
          value: summary.opportunities_found?.toString() || '0',
          inline: true
        },
        {
          name: '✅ Viable Opportunities',
          value: summary.viable_opportunities?.toString() || '0',
          inline: true
        },
        {
          name: '💰 Best Profit',
          value: summary.best_profit_usd ? `$${summary.best_profit_usd.toFixed(2)}` : '$0.00',
          inline: true
        },
        {
          name: '📈 Average Profit',
          value: summary.avg_profit_usd ? `$${summary.avg_profit_usd.toFixed(2)}` : '$0.00',
          inline: true
        },
        {
          name: '⛽ Avg Gas Price',
          value: summary.avg_gas_gwei ? `${summary.avg_gas_gwei.toFixed(1)} gwei` : 'N/A',
          inline: true
        }
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: `Period: ${summary.period || '24 hours'}`
      }
    };
    
    // Add breakdown by type
    if (summary.by_type) {
      const typeBreakdown = Object.entries(summary.by_type)
        .map(([type, count]) => `${type}: ${count}`)
        .join('\n');
      
      embed.fields.push({
        name: '📋 By Type',
        value: typeBreakdown || 'None',
        inline: false
      });
    }
    
    await this._sendWebhook(this.webhooks.general, {
      username: 'Allmight Daily Report',
      embeds: [embed]
    });
  }
  
  /**
   * Test Discord connection
   */
  async testConnection() {
    const embed = {
      title: '🧪 Discord Notification Test',
      description: 'If you can see this, Discord notifications are working!',
      color: 0x00FF00,
      fields: [
        {
          name: '✅ Status',
          value: 'Connected',
          inline: true
        },
        {
          name: '⏰ Time',
          value: new Date().toLocaleString(),
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };
    
    try {
      await this._sendWebhook(this.webhooks.general, {
        username: 'Allmight Test',
        embeds: [embed]
      });
      
      console.log('✅ Discord test notification sent successfully');
      return true;
    } catch (error) {
      console.error('❌ Discord test notification failed:', error.message);
      return false;
    }
  }
  
  // Private helper methods
  
  async _sendWebhook(webhookUrl, payload) {
    if (!webhookUrl || webhookUrl.includes('YOUR_') || webhookUrl === '****') {
      console.warn('⚠️  Discord webhook not configured');
      return;
    }
    
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status} ${response.statusText}`);
      }
      
      this.stats.sent++;
    } catch (error) {
      this.stats.failed++;
      console.error('❌ Failed to send Discord notification:', error.message);
      throw error;
    }
  }
  
  _isRateLimited(key) {
    const now = Date.now();
    const lastTime = this.lastNotificationTime[key] || 0;
    
    if (now - lastTime < this.minIntervalMs) {
      return true;
    }
    
    this.lastNotificationTime[key] = now;
    return false;
  }
  
  _getProfitColor(profit) {
    if (profit >= 500) return 0x00FF00;  // Bright green for high profit
    if (profit >= 200) return 0x32CD32;  // Green
    if (profit >= 100) return 0x90EE90;  // Light green
    return 0x0099FF;  // Blue for smaller profits
  }
  
  _formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
  
  getStats() {
    return {
      ...this.stats,
      enabled: this.enabled,
      webhooks_configured: Object.values(this.webhooks).filter(url => url && !url.includes('YOUR_')).length
    };
  }
}

// Singleton instance
let instance = null;

function getNotifier() {
  if (!instance) {
    instance = new DiscordNotifier();
  }
  return instance;
}

module.exports = getNotifier();

// Allow running standalone for testing
if (require.main === module) {
  (async () => {
    console.log('Testing Discord Notifier...\n');
    
    const notifier = getNotifier();
    
    console.log('Stats:', notifier.getStats());
    
    // Test connection
    await notifier.testConnection();
    
    // Test error notification
    console.log('\nSending test error...');
    await notifier.notifyError(
      new Error('This is a test error'),
      {
        component: 'DiscordNotifier Test',
        severity: 'low'
      }
    );
    
    // Test opportunity notification
    console.log('\nSending test opportunity...');
    await notifier.notifyOpportunity(
      {
        type: 'cross_dex',
        strategy: 'Buy Uniswap → Sell Sushiswap',
        pair: 'ETH/USDC',
        buy_exchange: 'uniswap_v3',
        sell_exchange: 'sushiswap',
        profit: {
          net_usd: 127.50,
          net_bps: 42.5,
          gross_usd: 145.30,
          gas_cost_usd: 17.80
        },
        recommended_trade_size: {
          recommended_usd: 10000
        }
      },
      {
        total_scans: 42,
        viable_percentage: 12.5
      }
    );
    
    console.log('\n✅ Test notifications sent!');
    console.log('Final stats:', notifier.getStats());
  })();
}
