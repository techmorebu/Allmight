#!/usr/bin/env python3
"""
utils/discord_alerts.py

Lightweight Discord notifier for AllMight.
All Python scripts import this module for Discord alerts.

Webhooks (from .env):
  DISCORD_ALERT_WEBHOOK    -- shadow EXECUTE events, urgent alerts
  DISCORD_DETAILED_WEBHOOK -- reports, daily summary
  DISCORD_TERMINAL_WEBHOOK -- heartbeat, process health

Usage:
    from utils.discord_alerts import discord

    discord.heartbeat("Fetcher OK -- 11 keys in Redis")
    discord.execute_alert("arbitrum", "ETH/USDT", "+16.4bps", "$1.22")
    discord.shadow_report(win_rate=72.0, trades=45, pnl=38.50, mvi_pass=False)
    discord.system_alert("WARNING: Redis went stale -- fetcher may be down")
    discord.daily_summary(scans=1440, executed=23, pnl=28.40, win_rate=69.6)
"""

import os
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path


def _load_env():
    """Load .env from repo root if not already in environment."""
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"\'')
        if key and val and key not in os.environ:
            os.environ[key] = val

_load_env()

ALERT_WEBHOOK    = os.getenv("DISCORD_ALERT_WEBHOOK", "")
DETAILED_WEBHOOK = os.getenv("DISCORD_DETAILED_WEBHOOK", "")
TERMINAL_WEBHOOK = os.getenv("DISCORD_TERMINAL_WEBHOOK", "")
ENABLED          = os.getenv("DISCORD_NOTIFICATIONS_ENABLED", "true").lower() == "true"

# Colors
GREEN  = 0x00FF00
ORANGE = 0xFFA500
RED    = 0xFF0000
BLUE   = 0x0099FF
GOLD   = 0xFFD700
GRAY   = 0x95A5A6


def _send(webhook_url: str, payload: dict) -> bool:
    """Send payload to Discord webhook. Returns True on success."""
    if not ENABLED:
        return True
    if not webhook_url or "YOUR_" in webhook_url or webhook_url == "****":
        print(f"[discord] WARNING: webhook not configured")
        return False
    try:
        data = json.dumps(payload).encode("utf-8")
        req  = urllib.request.Request(
            webhook_url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status in (200, 204)
    except urllib.error.HTTPError as e:
        print(f"[discord] HTTP {e.code}: {e.reason}")
        return False
    except Exception as e:
        print(f"[discord] send failed: {e}")
        return False


def _embed(title: str, description: str, color: int,
           fields: list = None, footer: str = "AllMight") -> dict:
    """Build a Discord embed dict."""
    e = {
        "title":       title,
        "description": description,
        "color":       color,
        "timestamp":   datetime.now(timezone.utc).isoformat(),
        "footer":      {"text": footer},
    }
    if fields:
        e["fields"] = fields
    return e


class DiscordAlerts:
    """AllMight Discord notification interface."""

    # ── Heartbeat ─────────────────────────────────────────────────────────────
    def heartbeat(self, message: str = "") -> bool:
        """
        Periodic health ping to TERMINAL channel.
        Call every hour to prove the system is alive.
        """
        from pathlib import Path
        import csv

        # Count shadow trades logged
        trade_log = Path(__file__).resolve().parent.parent / "logs/shadow_trades.csv"
        trade_count = 0
        if trade_log.exists():
            with open(trade_log) as f:
                trade_count = max(0, sum(1 for _ in f) - 1)  # subtract header

        ts  = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        desc = message or f"System running as of {ts}"

        embed = _embed(
            title       = "💚 AllMight Heartbeat",
            description = desc,
            color       = GREEN,
            fields      = [
                {"name": "Shadow trades logged", "value": str(trade_count), "inline": True},
                {"name": "Time",                 "value": ts,               "inline": True},
            ],
            footer = "AllMight Terminal"
        )
        return _send(TERMINAL_WEBHOOK, {"username": "AllMight", "embeds": [embed]})

    # ── Shadow EXECUTE alert ───────────────────────────────────────────────────
    def execute_alert(self, chain: str, pair: str,
                      gross_bps: str, net_usd: str) -> bool:
        """
        Fire when shadow mode logs an EXECUTE decision.
        Goes to ALERT channel.
        """
        embed = _embed(
            title       = "✅ SHADOW EXECUTE",
            description = f"**{chain.upper()} {pair}**",
            color       = GOLD,
            fields      = [
                {"name": "Gross edge", "value": gross_bps, "inline": True},
                {"name": "Net P&L",    "value": net_usd,   "inline": True},
                {"name": "Mode",       "value": "SHADOW -- no real tx", "inline": True},
            ],
            footer = "AllMight Shadow Mode"
        )
        return _send(ALERT_WEBHOOK, {"username": "AllMight", "embeds": [embed]})

    # ── Shadow report ─────────────────────────────────────────────────────────
    def shadow_report(self, win_rate: float, trades: int,
                      pnl: float, mvi_pass: bool) -> bool:
        """
        Periodic shadow mode summary.
        Goes to DETAILED channel.
        """
        gate_str = "✅ PASS" if mvi_pass else "❌ FAIL"
        color    = GREEN if mvi_pass else ORANGE

        embed = _embed(
            title       = "📊 Shadow Mode Report",
            description = f"MVI Gate: **{gate_str}**",
            color       = color,
            fields      = [
                {"name": "Win rate",       "value": f"{win_rate:.1f}%", "inline": True},
                {"name": "Trades logged",  "value": str(trades),        "inline": True},
                {"name": "Simulated P&L",  "value": f"${pnl:.4f}",     "inline": True},
                {"name": "Gate threshold", "value": "Win rate >= 60%",  "inline": True},
            ],
            footer = "AllMight Shadow Mode"
        )
        return _send(DETAILED_WEBHOOK, {"username": "AllMight", "embeds": [embed]})

    # ── System alert ──────────────────────────────────────────────────────────
    def system_alert(self, message: str, level: str = "WARNING") -> bool:
        """
        System-level alert (stale Redis, process down, etc).
        Goes to TERMINAL channel.
        """
        colors = {"WARNING": ORANGE, "ERROR": RED, "INFO": BLUE}
        emojis = {"WARNING": "⚠️",  "ERROR": "❌", "INFO": "ℹ️"}

        embed = _embed(
            title       = f"{emojis.get(level, '⚠️')} AllMight {level}",
            description = message,
            color       = colors.get(level, ORANGE),
            footer      = "AllMight Watchdog"
        )
        return _send(TERMINAL_WEBHOOK, {"username": "AllMight", "embeds": [embed]})

    # ── Daily summary ─────────────────────────────────────────────────────────
    def daily_summary(self, scans: int, executed: int,
                      pnl: float, win_rate: float) -> bool:
        """
        Daily summary report. Goes to DETAILED channel.
        """
        skipped  = scans - executed
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        embed = _embed(
            title       = f"📋 Daily Summary -- {date_str}",
            description = "Shadow mode 24-hour report",
            color       = BLUE,
            fields      = [
                {"name": "Scans",         "value": str(scans),          "inline": True},
                {"name": "EXECUTE",       "value": str(executed),       "inline": True},
                {"name": "SKIP",          "value": str(skipped),        "inline": True},
                {"name": "Win rate",      "value": f"{win_rate:.1f}%",  "inline": True},
                {"name": "Simulated P&L", "value": f"${pnl:.4f}",      "inline": True},
                {"name": "MVI Gate",
                 "value": "✅ PASS" if win_rate >= 60 else "❌ FAIL",
                 "inline": True},
            ],
            footer = "AllMight Daily Report"
        )
        return _send(DETAILED_WEBHOOK, {"username": "AllMight", "embeds": [embed]})

    # ── Test ──────────────────────────────────────────────────────────────────
    def test(self) -> None:
        """Send a test message to all three channels."""
        print("Testing TERMINAL webhook...")
        ok = self.heartbeat("Discord test -- all systems nominal")
        print("  OK" if ok else "  FAILED")

        print("Testing ALERT webhook...")
        ok = self.execute_alert("arbitrum", "ETH/USDT", "+16.4bps", "$+1.22")
        print("  OK" if ok else "  FAILED")

        print("Testing DETAILED webhook...")
        ok = self.shadow_report(win_rate=72.0, trades=45, pnl=38.50, mvi_pass=False)
        print("  OK" if ok else "  FAILED")


# Singleton
discord = DiscordAlerts()


if __name__ == "__main__":
    discord.test()
