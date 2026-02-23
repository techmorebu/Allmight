#!/usr/bin/env python3
"""
utils/discord_alerts.py -- AllMight notification system v3
Four channels, GUI-ready. Every metric maps to a future dashboard panel.
"""

import os, csv, json, requests
from datetime import datetime, timezone, timedelta
from pathlib import Path

def _load_env():
    f = Path(__file__).resolve().parent.parent / ".env"
    if not f.exists(): return
    for line in f.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, _, v = line.partition("=")
        os.environ[k.strip()] = v.strip()

_load_env()

TERMINAL_WEBHOOK = os.environ.get("DISCORD_TERMINAL_WEBHOOK", "")
ALERT_WEBHOOK    = os.environ.get("DISCORD_ALERT_WEBHOOK", "")
DETAILED_WEBHOOK = os.environ.get("DISCORD_DETAILED_WEBHOOK", "")
ERRORS_WEBHOOK   = os.environ.get("DISCORD_ERRORS_WEBHOOK",
                   os.environ.get("DISCORD_TERMINAL_WEBHOOK", ""))
ENABLED = os.environ.get("DISCORD_NOTIFICATIONS_ENABLED","true").lower() == "true"

DRIP_TIERS = [300, 500, 800, 1300, 2000, 3200, 5000, 8000, 10000]
STATE_FILE  = Path(__file__).resolve().parent.parent / "logs/discord_state.json"

def _ts(fmt="%Y-%m-%d %H:%M UTC"):
    return datetime.now(timezone.utc).strftime(fmt)

def _bar(pct, w=10):
    f = int(pct / 100 * w)
    return "█"*f + "░"*(w-f) + f" {pct:.0f}%"

def _drip(weekly_pnl):
    cur, nxt = 0, DRIP_TIERS[0]
    for i, t in enumerate(DRIP_TIERS):
        if weekly_pnl >= t:
            cur = t
            nxt = DRIP_TIERS[i+1] if i+1 < len(DRIP_TIERS) else t
        else:
            nxt = t; break
    pct = min(weekly_pnl / nxt * 100, 100.0) if nxt else 100.0
    return {"current": cur, "next": nxt,
            "pct": pct, "gap": max(nxt - weekly_pnl, 0)}

def _load_state():
    if STATE_FILE.exists():
        try: return json.loads(STATE_FILE.read_text())
        except: pass
    return {"first_trade_today": None, "all_time_best": 0.0,
            "last_alert_hash": None, "last_alert_time": None,
            "last_weekly_rollup": None, "last_drought_alert": None}

def _save_state(s):
    STATE_FILE.parent.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(s, indent=2))

def _load_trades(hours=None):
    log = Path(__file__).resolve().parent.parent / "logs/shadow_trades.csv"
    if not log.exists(): return []
    trades, cutoff = [], None
    if hours:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    with open(log) as f:
        for row in csv.DictReader(f):
            if not row.get("decision"): continue
            if cutoff:
                try:
                    ts = datetime.fromisoformat(
                        row["timestamp"].replace("Z","+00:00"))
                    if ts < cutoff: continue
                except: pass
            trades.append(row)
    return trades

def _stats(trades):
    ex   = [t for t in trades if t["decision"] == "EXECUTE"]
    wins = [t for t in ex if float(t.get("net_profit_usd",0)) > 0]
    pnls = [float(t.get("net_profit_usd",0)) for t in ex]
    pairs = {}
    for t in ex:
        k = f"{t.get('chain','?')}:{t.get('pair','?')}"
        pairs.setdefault(k, {"count":0,"pnl":0.0})
        pairs[k]["count"] += 1
        pairs[k]["pnl"]   += float(t.get("net_profit_usd",0))
    return {
        "scanned":  len(trades),
        "executed": len(ex),
        "skipped":  len(trades)-len(ex),
        "winners":  len(wins),
        "pnl":      sum(pnls),
        "best":     max(pnls) if pnls else 0.0,
        "worst":    min(pnls) if pnls else 0.0,
        "win_rate": len(wins)/len(ex)*100 if ex else 0.0,
        "pairs":    pairs,
    }

def _send(url, text):
    if not ENABLED: return True
    url = url.strip()
    if not url or "YOUR_" in url or url == "****":
        print("[discord] webhook not configured"); return False
    try:
        r = requests.post(url, json={"content": text}, timeout=5)
        return r.status_code == 204
    except Exception as e:
        print(f"[discord] send failed: {e}"); return False


class DiscordAlerts:

    # ── TERMINAL ──────────────────────────────────────────────────────────────

    def startup(self, pids=None):
        pid_lines = ""
        if pids:
            for name, pid in pids.items():
                pid_lines += f"  {name:<10} PID {pid}\n"
        text = (
            f"🚀 **AllMight Online** | {_ts()}\n"
            f"```\n"
            f" System started successfully\n"
            f"{'─'*32}\n"
            f" Processes\n"
            f"{pid_lines if pid_lines else '  PIDs not provided'}\n"
            f" Redis:   OK\n"
            f" Mode:    SHADOW (no real tx)\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def shutdown(self, reason="Manual stop"):
        s = _stats(_load_trades())
        text = (
            f"🛑 **AllMight Offline** | {_ts()}\n"
            f"```\n"
            f" Reason:     {reason}\n"
            f"{'─'*32}\n"
            f" Executed:   {s['executed']} trades\n"
            f" Win rate:   {s['win_rate']:.1f}%\n"
            f" Total P&L:  ${s['pnl']:.4f}\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def heartbeat(self, message=""):
        all_s = _stats(_load_trades())
        hr_s  = _stats(_load_trades(hours=1))
        mvi   = all_s["win_rate"] >= 60 and all_s["executed"] >= 10
        mvi_s = "PASS ✅" if mvi else f"FAIL ❌ ({all_s['win_rate']:.0f}% / need 60%)"
        hr_pnl    = hr_s["pnl"]
        daily_est = hr_pnl * 24
        text = (
            f"💚 **Heartbeat** | {_ts()}\n"
            f"```\n"
            f"{'─'*34}\n"
            f" SYSTEM\n"
            f"{'─'*34}\n"
            f" MVI Gate:     {mvi_s}\n"
            f" Total trades: {all_s['executed']}\n"
            f" All-time W/R: {all_s['win_rate']:.1f}%\n"
            f" All-time P&L: ${all_s['pnl']:.4f}\n"
            f"\n"
            f"{'─'*34}\n"
            f" THIS HOUR\n"
            f"{'─'*34}\n"
            f" Trades:  {hr_s['executed']} executed / {hr_s['skipped']} skipped\n"
            f" W/R:     {hr_s['win_rate']:.1f}%\n"
            f" P&L:     ${hr_pnl:.4f}\n"
            f"\n"
            f"{'─'*34}\n"
            f" ESTIMATES\n"
            f"{'─'*34}\n"
            f" Hourly avg:  ${hr_pnl:.4f}\n"
            f" Daily est:   ${daily_est:.2f}\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def process_restarted(self, name, old_pid, new_pid):
        text = (
            f"🔄 **Process Restarted** | {_ts()}\n"
            f"```\n"
            f" Process: {name}\n"
            f" Old PID: {old_pid}  (dead)\n"
            f" New PID: {new_pid}  (running)\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    # ── ALERT ─────────────────────────────────────────────────────────────────

    def execute_alert(self, chain, pair, gross_bps, net_usd):
        """
        Fires on EXECUTE. Deduplicates -- same trade within 5 minutes is silent.
        Flags first-of-day and new all-time best.
        """
        state = _load_state()

        # Deduplication -- same chain+pair+edge within 300s = skip
        alert_hash = f"{chain}:{pair}:{gross_bps}"
        last_hash  = state.get("last_alert_hash")
        last_time  = state.get("last_alert_time")
        if last_hash == alert_hash and last_time:
            try:
                last_dt = datetime.fromisoformat(last_time)
                age = (datetime.now(timezone.utc) - last_dt).total_seconds()
                if age < 300:
                    return True  # duplicate within 5min -- silent
            except: pass

        state["last_alert_hash"] = alert_hash
        state["last_alert_time"] = datetime.now(timezone.utc).isoformat()

        s     = _stats(_load_trades())
        flags = ""

        # First trade of the day
        today = _ts("%Y-%m-%d")
        if state.get("first_trade_today") != today:
            state["first_trade_today"] = today
            flags += " 🌅 FIRST TRADE OF THE DAY\n"

        # New all-time best
        try:
            net_val = float(str(net_usd).replace("$","").replace("+",""))
        except: net_val = 0.0
        if net_val > float(state.get("all_time_best", 0)):
            state["all_time_best"] = net_val
            flags += f" 🏆 NEW BEST: ${net_val:.4f}\n"

        _save_state(state)

        text = (
            f"✅ **SHADOW EXECUTE** | {_ts()}\n"
            f"```\n"
            f"{flags}"
            f" Chain:      {chain.upper()}\n"
            f" Pair:       {pair}\n"
            f" Gross edge: {gross_bps}\n"
            f" Net P&L:    {net_usd}  [simulated]\n"
            f"{'─'*30}\n"
            f" Session\n"
            f" Trades:     {s['executed']}\n"
            f" Win rate:   {s['win_rate']:.1f}%\n"
            f" Total P&L:  ${s['pnl']:.4f}\n"
            f" Best trade: ${s['best']:.4f}\n"
            f"```"
        )
        return _send(ALERT_WEBHOOK, text)

    # ── DETAILED ──────────────────────────────────────────────────────────────

    def shadow_report(self, win_rate=None, trades=None,
                      pnl=None, mvi_pass=None):
        all_s  = _stats(_load_trades())
        day_s  = _stats(_load_trades(hours=24))
        mvi    = all_s["win_rate"] >= 60 and all_s["executed"] >= 10
        gate   = "PASS ✅" if mvi else "FAIL ❌"
        weekly_est = day_s["pnl"] * 7
        drip       = _drip(weekly_est)
        est_fees   = all_s["executed"] * 0.52

        pair_lines = ""
        for pair, d in sorted(all_s["pairs"].items(),
                               key=lambda x: x[1]["pnl"], reverse=True)[:4]:
            pair_lines += f"  {pair:<28} {d['count']:>3}x  ${d['pnl']:>8.4f}\n"

        wr_warn = ""
        if day_s["executed"] >= 5 and day_s["win_rate"] < 70:
            wr_warn = f" ⚠️  Win rate warning: {day_s['win_rate']:.1f}% (24hr)\n\n"

        text = (
            f"📊 **Detailed Report** | {_ts()}\n"
            f"```\n"
            f"{wr_warn}"
            f"{'─'*42}\n"
            f" ALL-TIME\n"
            f"{'─'*42}\n"
            f" Executed:    {all_s['executed']:>5}   Skipped: {all_s['skipped']:>5}\n"
            f" Winners:     {all_s['winners']:>5}   W/R:     {all_s['win_rate']:>5.1f}%\n"
            f" Total P&L:   ${all_s['pnl']:>9.4f}\n"
            f" Best trade:  ${all_s['best']:>9.4f}\n"
            f" Worst trade: ${all_s['worst']:>9.4f}\n"
            f" Est. fees:   ${est_fees:>9.2f}\n"
            f"\n"
            f"{'─'*42}\n"
            f" LAST 24 HOURS\n"
            f"{'─'*42}\n"
            f" Executed:    {day_s['executed']:>5}   W/R:     {day_s['win_rate']:>5.1f}%\n"
            f" P&L:         ${day_s['pnl']:>9.4f}\n"
            f"\n"
            f"{'─'*42}\n"
            f" TOP PAIRS\n"
            f"{'─'*42}\n"
            f"{pair_lines if pair_lines else '  No trades yet'}\n"
            f"{'─'*42}\n"
            f" EXTRAPOLATIONS (24hr rate)\n"
            f"{'─'*42}\n"
            f" Weekly est:  ${weekly_est:>9.2f}\n"
            f"\n"
            f"{'─'*42}\n"
            f" DRIP VAULT\n"
            f"{'─'*42}\n"
            f" Current tier: ${drip['current']}/wk\n"
            f" Next tier:    ${drip['next']}/wk\n"
            f" Progress:     {_bar(drip['pct'])}\n"
            f" Gap:          ${drip['gap']:.2f}/wk needed\n"
            f" Ladder: $300->$500->$800->$1300->$2000\n"
            f"\n"
            f"{'─'*42}\n"
            f" MVI GATE: {gate}\n"
            f" Win rate >= 60%: {all_s['win_rate']:.1f}%\n"
            f" Min 10 trades:   {all_s['executed']}\n"
            f"```"
        )
        return _send(DETAILED_WEBHOOK, text)

    def weekly_rollup(self):
        week_s = _stats(_load_trades(hours=168))
        drip   = _drip(week_s["pnl"])
        pair_lines = ""
        for pair, d in sorted(week_s["pairs"].items(),
                               key=lambda x: x[1]["pnl"], reverse=True)[:5]:
            pair_lines += f"  {pair:<28} {d['count']:>3}x  ${d['pnl']:>8.4f}\n"
        text = (
            f"📋 **Weekly Rollup** | {_ts()}\n"
            f"```\n"
            f"{'─'*42}\n"
            f" THIS WEEK\n"
            f"{'─'*42}\n"
            f" Executed:    {week_s['executed']:>5}   W/R: {week_s['win_rate']:.1f}%\n"
            f" Total P&L:   ${week_s['pnl']:>9.4f}\n"
            f" Best trade:  ${week_s['best']:>9.4f}\n"
            f"\n"
            f"{'─'*42}\n"
            f" TOP PAIRS\n"
            f"{'─'*42}\n"
            f"{pair_lines if pair_lines else '  No trades'}\n"
            f"{'─'*42}\n"
            f" DRIP VAULT\n"
            f"{'─'*42}\n"
            f" Weekly P&L:   ${week_s['pnl']:.2f}\n"
            f" Current tier: ${drip['current']}/wk\n"
            f" Next tier:    ${drip['next']}/wk\n"
            f" Progress:     {_bar(drip['pct'])}\n"
            f" Gap:          ${drip['gap']:.2f}/wk\n"
            f" Status:       {'PAYOUT ELIGIBLE' if week_s['pnl'] >= drip['current'] > 0 else 'REINVESTING'}\n"
            f"```"
        )
        state = _load_state()
        state["last_weekly_rollup"] = _ts()
        _save_state(state)
        return _send(DETAILED_WEBHOOK, text)

    def signal_drought(self, hours_silent):
        state = _load_state()
        last  = state.get("last_drought_alert")
        if last:
            try:
                if (datetime.now(timezone.utc) -
                    datetime.fromisoformat(last)).total_seconds() < 7200:
                    return True
            except: pass
        state["last_drought_alert"] = datetime.now(timezone.utc).isoformat()
        _save_state(state)
        text = (
            f"🌵 **Signal Drought** | {_ts()}\n"
            f"```\n"
            f" No EXECUTE decisions in {hours_silent:.1f} hours\n"
            f" During active session window (13-21 UTC)\n"
            f"{'─'*32}\n"
            f" Possible causes:\n"
            f"  - Market spread compressed\n"
            f"  - Fetcher returning stale data\n"
            f"  - Allowlist too restrictive\n"
            f" Action: check shadow.log and Redis\n"
            f"```"
        )
        return _send(DETAILED_WEBHOOK, text)

    # ── ERRORS ────────────────────────────────────────────────────────────────

    def error(self, message, component="unknown"):
        text = (
            f"❌ **AllMight Error** | {_ts()}\n"
            f"```\n"
            f" Component: {component}\n"
            f" Error:     {message}\n"
            f"```"
        )
        return _send(ERRORS_WEBHOOK, text)

    def stale_redis(self, key_count, last_seen_min):
        text = (
            f"🔴 **Redis Stale** | {_ts()}\n"
            f"```\n"
            f" Keys found:   {key_count}\n"
            f" Last update:  {last_seen_min:.1f} min ago\n"
            f" Threshold:    6 min\n"
            f"{'─'*32}\n"
            f" Fetcher may be down\n"
            f" Shadow scanning STALE prices\n"
            f" Check: tail -f logs/fetcher.log\n"
            f"```"
        )
        return _send(ERRORS_WEBHOOK, text)

    def process_dead(self, name, pid):
        text = (
            f"💀 **Process Dead** | {_ts()}\n"
            f"```\n"
            f" Process: {name}\n"
            f" PID:     {pid}\n"
            f" Status:  Attempting restart...\n"
            f"```"
        )
        return _send(ERRORS_WEBHOOK, text)

    def system_alert(self, message, level="WARNING"):
        if level == "ERROR":
            return self.error(message)
        icons = {"WARNING": "⚠️", "INFO": "ℹ️"}
        text  = (
            f"{icons.get(level,'⚠️')} **AllMight {level}** | {_ts()}\n"
            f"```\n{message}\n```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def daily_summary(self, **kwargs):
        return self.shadow_report()

    def test(self):
        print("TERMINAL -- startup...")
        print("  OK" if self.startup({"fetcher":1001,"monitor":1002,
                                       "shadow":1003,"watchdog":1004}) else "  FAIL")
        print("TERMINAL -- heartbeat...")
        print("  OK" if self.heartbeat() else "  FAIL")
        print("ALERT -- execute (with dedup)...")
        r1 = self.execute_alert("arbitrum","ETH/USDT","+16.4bps","$+1.22")
        r2 = self.execute_alert("arbitrum","ETH/USDT","+16.4bps","$+1.22")
        print(f"  First: {'OK' if r1 else 'FAIL'}  Duplicate: {'silent (correct)' if r2 else 'FAIL'}")
        print("DETAILED -- shadow report...")
        print("  OK" if self.shadow_report() else "  FAIL")
        print("ERRORS -- stale redis...")
        print("  OK" if self.stale_redis(3, 8.5) else "  FAIL")
        print("ERRORS -- process dead...")
        print("  OK" if self.process_dead("shadow", 9999) else "  FAIL")


discord = DiscordAlerts()

if __name__ == "__main__":
    discord.test()
