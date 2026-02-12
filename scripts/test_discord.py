#!/usr/bin/env python3
"""
Discord Webhook Test Script
Tests connection to Discord webhooks before starting monitoring

Usage:
    python3 scripts/test_discord.py
"""

import os
import sys

# Check for required packages
try:
    import requests
    from dotenv import load_dotenv
except ImportError as e:
    print("❌ Missing required package!")
    print()
    print("Install with:")
    print("  pip3 install requests python-dotenv --break-system-packages")
    print()
    sys.exit(1)

from datetime import datetime


def test_webhook(webhook_url: str, webhook_name: str, channel_name: str) -> bool:
    """
    Test a Discord webhook
    
    Args:
        webhook_url: Discord webhook URL
        webhook_name: Name for display (e.g., "Alert")
        channel_name: Channel name (e.g., "#arbitrage-alerts")
        
    Returns:
        True if successful, False otherwise
    """
    
    print(f"📢 Testing {webhook_name} webhook → {channel_name}...")
    
    # Create test message
    payload = {
        'embeds': [{
            'title': f'✅ WEBHOOK TEST - {webhook_name.upper()}',
            'description': f'Allmight system connected to {channel_name} successfully!',
            'color': 0x00FF00,  # Green
            'fields': [
                {
                    'name': '🎯 Status',
                    'value': 'Connected',
                    'inline': True
                },
                {
                    'name': '⏰ Time',
                    'value': datetime.now().strftime('%H:%M:%S'),
                    'inline': True
                },
                {
                    'name': '📍 System',
                    'value': 'Allmight Arbitrage Scanner',
                    'inline': False
                }
            ],
            'timestamp': datetime.utcnow().isoformat(),
            'footer': {
                'text': 'If you see this message, webhooks are working!'
            }
        }]
    }
    
    try:
        response = requests.post(webhook_url, json=payload, timeout=10)
        
        if response.status_code == 204:
            print(f"   ✅ Success! Check your Discord {channel_name} channel!")
            return True
        else:
            print(f"   ❌ Failed: HTTP {response.status_code}")
            if response.text:
                print(f"   Error: {response.text}")
            return False
            
    except requests.exceptions.Timeout:
        print(f"   ❌ Timeout: Could not reach Discord (check internet connection)")
        return False
    except requests.exceptions.RequestException as e:
        print(f"   ❌ Error: {str(e)}")
        return False


def main():
    """Main test function"""
    
    print("=" * 70)
    print("🧪 DISCORD WEBHOOK TEST")
    print("=" * 70)
    print()
    
    # Load environment variables
    load_dotenv()
    
    alert_webhook = os.getenv('DISCORD_ALERT_WEBHOOK')
    detailed_webhook = os.getenv('DISCORD_DETAILED_WEBHOOK')
    notifications_enabled = os.getenv('DISCORD_NOTIFICATIONS_ENABLED', 'false').lower() == 'true'
    
    # Check if webhooks are configured
    print("📋 Configuration Check:")
    print("-" * 70)
    
    if not alert_webhook or alert_webhook == 'https://discord.com/api/webhooks/YOUR_ALERT_WEBHOOK_URL_HERE':
        print("❌ DISCORD_ALERT_WEBHOOK not configured in .env")
        alert_configured = False
    else:
        print(f"✅ DISCORD_ALERT_WEBHOOK configured")
        alert_configured = True
    
    if not detailed_webhook or detailed_webhook == 'https://discord.com/api/webhooks/YOUR_DETAILED_WEBHOOK_URL_HERE':
        print("❌ DISCORD_DETAILED_WEBHOOK not configured in .env")
        detailed_configured = False
    else:
        print(f"✅ DISCORD_DETAILED_WEBHOOK configured")
        detailed_configured = True
    
    print(f"{'✅' if notifications_enabled else '⚠️'} DISCORD_NOTIFICATIONS_ENABLED = {notifications_enabled}")
    
    print()
    
    # Test webhooks
    if not alert_configured and not detailed_configured:
        print("=" * 70)
        print("❌ NO WEBHOOKS CONFIGURED")
        print("=" * 70)
        print()
        print("To configure Discord webhooks:")
        print()
        print("1. Create Discord channels:")
        print("   - #arbitrage-alerts (for quick alerts)")
        print("   - #detailed-logs (for full analysis)")
        print()
        print("2. Create webhooks:")
        print("   - Right-click channel → Edit Channel")
        print("   - Integrations → Webhooks → Create Webhook")
        print("   - Copy webhook URL")
        print()
        print("3. Add to .env file:")
        print("   DISCORD_ALERT_WEBHOOK=https://discord.com/api/webhooks/...")
        print("   DISCORD_DETAILED_WEBHOOK=https://discord.com/api/webhooks/...")
        print("   DISCORD_NOTIFICATIONS_ENABLED=true")
        print()
        return False
    
    results = []
    
    # Test alert webhook
    if alert_configured:
        print()
        success = test_webhook(alert_webhook, "Alert", "#arbitrage-alerts")
        results.append(('Alert', success))
    
    # Test detailed webhook
    if detailed_configured:
        print()
        success = test_webhook(detailed_webhook, "Detailed", "#detailed-logs")
        results.append(('Detailed', success))
    
    # Summary
    print()
    print("=" * 70)
    print("📊 TEST SUMMARY")
    print("=" * 70)
    
    all_success = all(success for _, success in results)
    
    for name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{name} webhook: {status}")
    
    print()
    
    if all_success:
        print("✅ ALL TESTS PASSED!")
        print()
        print("🚀 Discord is ready! You can now:")
        print("   1. Run monitoring: python3 scripts/master_integration_enhanced.py --mode continuous")
        print("   2. Get real-time alerts in Discord")
        print()
        return True
    else:
        print("❌ SOME TESTS FAILED")
        print()
        print("Common issues:")
        print("   - Check webhook URLs are correct in .env")
        print("   - Verify webhooks weren't deleted in Discord")
        print("   - Check internet connection")
        print()
        return False


if __name__ == '__main__':
    success = main()
    sys.exit(0 if success else 1)
