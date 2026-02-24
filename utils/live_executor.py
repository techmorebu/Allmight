#!/usr/bin/env python3
"""
utils/live_executor.py

Python bridge that calls execute_trade.js and handles the result.
Called by shadow_mode.py when --live flag is set and an opportunity passes filters.

Usage in shadow_mode.py:
    from utils.live_executor import LiveExecutor
    executor = LiveExecutor()
    result = executor.execute(opportunity)
"""

import json, subprocess, os, time, csv
from pathlib import Path
from datetime import datetime, timezone

ROOT         = Path(__file__).resolve().parent.parent
BRIDGE_JS    = ROOT / "scripts/execution/execute_trade.js"
LIVE_LOG     = ROOT / "logs/live_trades.csv"
LIVE_STATE   = ROOT / "logs/live_state.json"

# ── Safety limits ─────────────────────────────────────────────────────────────
MAX_TRADES_PER_HOUR   = 10     # hard cap -- no runaway execution
MAX_CONSECUTIVE_REVERTS = 3    # pause if contract keeps reverting
MIN_INTERVAL_SEC      = 15     # minimum seconds between live trades

class LiveExecutor:

    def __init__(self):
        self.enabled     = os.environ.get("LIVE_TRADING_ENABLED", "false").lower() == "true"
        self.state       = self._load_state()
        self._ensure_log()

    # ── Public ────────────────────────────────────────────────────────────────

    def execute(self, opp: dict) -> dict:
        """
        Main entry point. Called by shadow_mode with opportunity dict.
        Returns result dict with success, profit, tx_hash etc.
        Always safe to call -- all guards run first.
        """
        if not self.enabled:
            return {"success": False, "skipped": True,
                    "reason": "Live trading disabled (LIVE_TRADING_ENABLED != true)"}

        # ── Rate limit checks ─────────────────────────────────────────────
        guard = self._check_guards(opp)
        if not guard["ok"]:
            return {"success": False, "skipped": True, "reason": guard["reason"]}

        # ── Inject session_id ─────────────────────────────────────────────
        opp["session_id"] = self._get_session_id()

        # ── Call execute_trade.js ─────────────────────────────────────────
        result = self._call_bridge(opp)

        # ── Update state and log ──────────────────────────────────────────
        self._update_state(result)
        self._log_trade(opp, result)

        # ── Discord notification ──────────────────────────────────────────
        self._notify(opp, result)

        return result

    def is_enabled(self) -> bool:
        return self.enabled

    def status(self) -> dict:
        s = self.state
        return {
            "enabled":           self.enabled,
            "total_live":        s.get("total_live", 0),
            "total_live_pnl":    s.get("total_live_pnl", 0.0),
            "trades_this_hour":  self._trades_this_hour(),
            "consecutive_reverts": s.get("consecutive_reverts", 0),
            "last_trade_at":     s.get("last_trade_at", None),
            "paused_until":      s.get("paused_until", None),
        }

    # ── Guards ────────────────────────────────────────────────────────────────

    def _check_guards(self, opp) -> dict:
        now = time.time()
        s   = self.state

        # Paused?
        paused_until = s.get("paused_until", 0)
        if paused_until and now < paused_until:
            remaining = int(paused_until - now)
            return {"ok": False, "reason": f"Paused for {remaining}s (consecutive reverts)"}

        # Rate limit: max trades per hour
        if self._trades_this_hour() >= MAX_TRADES_PER_HOUR:
            return {"ok": False, "reason": f"Rate limit: {MAX_TRADES_PER_HOUR} trades/hr reached"}

        # Minimum interval between trades
        last = s.get("last_trade_at", 0)
        if last and (now - last) < MIN_INTERVAL_SEC:
            wait = int(MIN_INTERVAL_SEC - (now - last))
            return {"ok": False, "reason": f"Too soon -- wait {wait}s"}

        # Consecutive reverts -- pause 5 minutes
        if s.get("consecutive_reverts", 0) >= MAX_CONSECUTIVE_REVERTS:
            pause_until = now + 300
            s["paused_until"] = pause_until
            self._save_state()
            return {"ok": False, "reason": "Paused 5min after consecutive reverts"}

        return {"ok": True}

    def _trades_this_hour(self) -> int:
        now     = time.time()
        hr_ago  = now - 3600
        history = self.state.get("trade_times", [])
        return sum(1 for t in history if t > hr_ago)

    # ── Bridge call ───────────────────────────────────────────────────────────

    def _call_bridge(self, opp: dict) -> dict:
        if not BRIDGE_JS.exists():
            return {"success": False,
                    "error": f"execute_trade.js not found at {BRIDGE_JS}"}
        try:
            proc = subprocess.run(
                ["node", str(BRIDGE_JS)],
                input=json.dumps(opp),
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(ROOT),
            )
            # Parse result from stdout
            stdout = proc.stdout.strip()
            if stdout:
                result = json.loads(stdout)
            else:
                result = {
                    "success": False,
                    "error":   "No output from bridge",
                    "stderr":  proc.stderr[:200],
                }
            return result
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Bridge timeout (30s)"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ── State management ──────────────────────────────────────────────────────

    def _load_state(self) -> dict:
        if LIVE_STATE.exists():
            try:
                return json.loads(LIVE_STATE.read_text())
            except: pass
        return {
            "total_live": 0,
            "total_live_pnl": 0.0,
            "consecutive_reverts": 0,
            "last_trade_at": None,
            "paused_until": None,
            "trade_times": [],
        }

    def _save_state(self):
        LIVE_STATE.parent.mkdir(exist_ok=True)
        LIVE_STATE.write_text(json.dumps(self.state, indent=2))

    def _update_state(self, result: dict):
        now = time.time()
        s   = self.state

        s.setdefault("trade_times", [])
        s["trade_times"].append(now)
        # Keep only last 24hrs
        s["trade_times"] = [t for t in s["trade_times"] if t > now - 86400]
        s["last_trade_at"] = now

        if result.get("success"):
            s["total_live"]      = s.get("total_live", 0) + 1
            s["total_live_pnl"]  = round(
                s.get("total_live_pnl", 0.0) + result.get("actual_profit_usd", 0), 6)
            s["consecutive_reverts"] = 0
        elif result.get("reverted"):
            s["consecutive_reverts"] = s.get("consecutive_reverts", 0) + 1
        else:
            s["consecutive_reverts"] = 0  # errors don't count as reverts

        self._save_state()

    def _get_session_id(self) -> str:
        session_file = ROOT / "logs/session_start.json"
        if session_file.exists():
            try:
                d = json.loads(session_file.read_text())
                return d.get("session_id", "unknown")
            except: pass
        return "unknown"

    # ── CSV logging ───────────────────────────────────────────────────────────

    def _ensure_log(self):
        if not LIVE_LOG.exists():
            LIVE_LOG.parent.mkdir(exist_ok=True)
            with open(LIVE_LOG, "w", newline="") as f:
                csv.writer(f).writerow([
                    "timestamp", "session_id", "pair", "buy_venue", "sell_venue",
                    "gross_bps", "simulated_usd", "actual_usd", "gas_eth",
                    "tx_hash", "block", "elapsed_ms", "success", "error"
                ])

    def _log_trade(self, opp: dict, result: dict):
        try:
            with open(LIVE_LOG, "a", newline="") as f:
                csv.writer(f).writerow([
                    datetime.now(timezone.utc).isoformat(),
                    opp.get("session_id", ""),
                    opp.get("pair", ""),
                    opp.get("buy_venue", ""),
                    opp.get("sell_venue", ""),
                    opp.get("gross_bps", 0),
                    opp.get("net_profit_usd", 0),
                    result.get("actual_profit_usd", 0),
                    result.get("gas_cost_eth", 0),
                    result.get("tx_hash", ""),
                    result.get("block", ""),
                    result.get("elapsed_ms", 0),
                    result.get("success", False),
                    result.get("error", ""),
                ])
        except Exception as e:
            print(f"[executor] CSV log error: {e}")

    # ── Discord ───────────────────────────────────────────────────────────────

    def _notify(self, opp: dict, result: dict):
        try:
            from utils.discord_alerts import discord
            if result.get("success"):
                discord.live_execute(
                    pair=opp.get("pair",""),
                    gross_bps=opp.get("gross_bps",0),
                    simulated_usd=opp.get("net_profit_usd",0),
                    actual_usd=result.get("actual_profit_usd",0),
                    tx_hash=result.get("tx_hash",""),
                    gas_eth=result.get("gas_cost_eth",0),
                    session_id=opp.get("session_id",""),
                )
            elif result.get("reverted"):
                discord.live_revert(
                    pair=opp.get("pair",""),
                    gross_bps=opp.get("gross_bps",0),
                    session_id=opp.get("session_id",""),
                )
            elif not result.get("skipped"):
                discord.error(
                    f"Live trade failed: {result.get('error','unknown')}",
                    component="live_executor"
                )
        except Exception as e:
            print(f"[executor] Discord notify error: {e}")


# ── CLI test ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    ex = LiveExecutor()
    print("LiveExecutor status:")
    print(json.dumps(ex.status(), indent=2))

    if "--dry-run" in sys.argv:
        print("\nDry run -- testing bridge call with dummy opportunity...")
        dummy = {
            "pair":           "ETH/USDT",
            "buy_venue":      "uniswap_v3",
            "sell_venue":     "curve",
            "gross_bps":      45.0,
            "net_profit_usd": 4.50,
            "trade_size_usd": 100,
        }
        result = ex._call_bridge(dummy)
        print(json.dumps(result, indent=2))
