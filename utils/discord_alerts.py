#!/usr/bin/env python3
"""
utils/discord_alerts.py

Discord notifier for AllMight.
Uses plain text + Discord markdown (embeds blocked by channel permissions).
Confirmed working pattern: requests.post() with content field only.

Webhooks (from .env):
  DISCORD_ALERT_WEBHOOK    -- EXECUTE events, urgent alerts
  DISCORD_DETAILED_WEBHOOK -- shadow reports, daily summary
  DISCORD_TERMINAL_WEBHOOK -- heartbeat, process health
"""

import os
import requests
from datetime import datetime, timezone
from pathlib import Path


def _load_env():
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ[key.strip()] = val.strip()


_load_env()

ALERT_WEBHOOK    = os.environ.get("DISCORD_ALERT_WEBHOOK", "")
DETAILED_WEBHOOK = os.environ.get("DISCORD_DETAILED_WEBHOOK", "")
TERMINAL_WEBHOOK = os.environ.get("DISCORD_TERMINAL_WEBHOOK", "")
ENABLED          = os.environ.get("DISCORD_NOTIFICATIONS_ENABLED", "true").lower() == "true"


def _send(webhook_url: str, text: str) -> bool:
    """Send plain text to Discord webhook."""
    if not ENABLED:
        return True
    url = webhook_url.strip()
    if not url or "YOUR_" in url or url == "****":
        print("[discord] webhook not configured")
        return False
    try:
        r = requests.post(url, json={"content": text}, timeout=5)
        if r.status_code == 204:
            return True
        print(f"[discord] status {r.status_code}: {r.text[:120]}")
        return False
    except Exception as e:
        print(f"[discord] send failed: {e}")
        return False


def _ts():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


class DiscordAlerts:

    def heartbeat(self, message=""):
        trade_log = Path(__file__).resolve().parent.parent / "logs/shadow_trades.csv"
        trade_count = 0
        if trade_log.exists():
            with open(trade_log) as f:
                trade_count = max(0, sum(1 for _ in f) - 1)
        msg = message or "System running"
        text = (
            f"💚 **AllMight Heartbeat** | {_ts()}\n"
            f"```\n"
            f"Status:        {msg}\n"
            f"Shadow trades: {trade_count}\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def execute_alert(self, chain, pair, gross_bps, net_usd):
        text = (
            f"✅ **SHADOW EXECUTE** | {_ts()}\n"
            f"```\n"
            f"Chain:      {chain.upper()}\n"
            f"Pair:       {pair}\n"
            f"Gross edge: {gross_bps}\n"
            f"Net P&L:    {net_usd}\n"
            f"Mode:       SHADOW -- no real tx\n"
            f"```"
        )
        return _send(ALERT_WEBHOOK, text)

    def shadow_report(self, win_rate, trades, pnl, mvi_pass):
        gate = "PASS ✅" if mvi_pass else "FAIL ❌"
        text = (
            f"📊 **Shadow Mode Report** | {_ts()}\n"
            f"```\n"
            f"Win rate:      {win_rate:.1f}%\n"
            f"Trades logged: {trades}\n"
            f"Simulated P&L: ${pnl:.4f}\n"
            f"MVI Gate:      {gate} (threshold: 60%)\n"
            f"```"
        )
        return _send(DETAILED_WEBHOOK, text)

    def system_alert(self, message, level="WARNING"):
        icons = {"WARNING": "⚠️", "ERROR": "❌", "INFO": "ℹ️"}
        icon  = icons.get(level, "⚠️")
        text  = (
            f"{icon} **AllMight {level}** | {_ts()}\n"
            f"```\n{message}\n```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def daily_summary(self, scans, executed, pnl, win_rate):
        gate = "PASS" if win_rate >= 60 else "FAIL"
        text = (
            f"📋 **Daily Summary** | {_ts()}\n"
            f"```\n"
            f"Scans:         {scans}\n"
            f"EXECUTE:       {executed}\n"
            f"SKIP:          {scans - executed}\n"
            f"Win rate:      {win_rate:.1f}%\n"
            f"Simulated P&L: ${pnl:.4f}\n"
            f"MVI Gate:      {gate}\n"
            f"```"
        )
        return _send(DETAILED_WEBHOOK, text)

    def test(self):
        print("Testing TERMINAL webhook...")
        print("  OK" if self.heartbeat("Discord test -- all systems nominal") else "  FAILED")
        print("Testing ALERT webhook...")
        print("  OK" if self.execute_alert("arbitrum", "ETH/USDT", "+16.4bps", "$+1.22") else "  FAILED")
        print("Testing DETAILED webhook...")
        print("  OK" if self.shadow_report(72.0, 45, 38.50, False) else "  FAILED")


discord = DiscordAlerts()

if __name__ == "__main__":
    discord.test()
