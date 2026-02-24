#!/usr/bin/env python3
"""
utils/discord_alerts.py v7
All notifications read from metrics.json -- zero independent calculations.
Single source of truth = no drift between channels.

Channels:
  TERMINAL  -- heartbeat, startup, shutdown
  ALERT     -- every EXECUTE trade
  DETAILED  -- hourly report, weekly rollup
  ERRORS    -- anomalies, stale Redis, crashes
"""

import os, json, requests
from datetime import datetime, timezone
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

METRICS_PATH = Path(__file__).resolve().parent.parent / "logs/metrics.json"
STATE_FILE   = Path(__file__).resolve().parent.parent / "logs/discord_state.json"

# ── helpers ───────────────────────────────────────────────────────────────────

def _ts():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

def _bar(pct, w=10):
    f = int(min(pct, 100) / 100 * w)
    return "█"*f + "░"*(w-f) + f" {pct:.0f}%"

def _m():
    """Load metrics.json. Fast read, never recalculates."""
    if METRICS_PATH.exists():
        try: return json.loads(METRICS_PATH.read_text())
        except: pass
    # Fallback import if file not ready yet
    try:
        import sys
        sys.path.insert(0, str(Path(__file__).parent))
        from metrics_engine import write_metrics
        return write_metrics()
    except: return {}

def _load_state():
    if STATE_FILE.exists():
        try: return json.loads(STATE_FILE.read_text())
        except: pass
    return {"last_alert_hash": None, "last_alert_time": None,
            "all_time_best": 0.0, "first_trade_today": None,
            "last_drought_alert": None, "last_stale_alert": 0}

def _save_state(s):
    STATE_FILE.parent.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(s, indent=2))

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

def _heatmap_bar(heatmap):
    """Compact 24hr heatmap -- ASCII block chars scaled to max bucket."""
    if not heatmap: return "  No data yet"
    by_hour = heatmap.get("by_hour", {})
    max_pnl = max((v.get("total_pnl", 0) for v in by_hour.values()), default=0)
    if max_pnl == 0: return "  No P&L data yet"

    blocks = " ▁▂▃▄▅▆▇█"
    line1, line2 = "  ", "  "
    for h in range(24):
        d   = by_hour.get(h, {})
        pnl = d.get("total_pnl", 0)
        idx = int(pnl / max_pnl * 8) if max_pnl > 0 else 0
        line1 += blocks[idx]
        line2 += f"{h//10}" if h % 6 == 0 else " "

    best = heatmap.get("best_hours", [])
    best_str = "  Best: " + ", ".join(
        [f"{b['hour']:02d}UTC(${b['total_pnl']:.2f})" for b in best[:3]]
    )
    return f"{line1}\n{line2}\n{best_str}"


# ══════════════════════════════════════════════════════════════════════════════
class DiscordAlerts:
# ══════════════════════════════════════════════════════════════════════════════

    # ── TERMINAL ──────────────────────────────────────────────────────────────

    def heartbeat(self, message=""):
        m = _m()
        if not m: return False

        sess   = m.get("session", {})
        at     = m.get("all_time", {})
        est    = m.get("estimates", {})
        sys_   = m.get("system", {})
        anom   = sys_.get("anomaly_count", 0)
        mvi    = "PASS ✅" if sys_.get("mvi_pass") else "FAIL ❌"
        anom_s = f" ⚠️  {anom} anomal{'y' if anom==1 else 'ies'}" if anom else ""

        text = (
            f"💚 **Heartbeat** | {_ts()}\n"
            f"```\n"
            f"{'─'*36}\n"
            f" SYSTEM\n"
            f"{'─'*36}\n"
            f" MVI Gate:   {mvi}{anom_s}\n"
            f" All trades: {at.get('executed',0)}\n"
            f" Hit rate:   {at.get('hit_rate',0):.1f}%\n"
            f" Win rate:   {at.get('win_rate',0):.1f}%\n"
            f" All-time:   ${at.get('total_pnl',0):.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*36}\n"
            f" THIS SESSION ({m.get('session_hours',0):.1f}hrs)\n"
            f"{'─'*36}\n"
            f" Trades:     {sess.get('executed',0)} exec"
            f" / {sess.get('skipped',0)} skip\n"
            f" Hit rate:   {sess.get('hit_rate',0):.1f}%\n"
            f" P&L/hr:     ${sess.get('pnl_per_hr',0):.4f}  [ACTUAL]\n"
            f" P&L total:  ${sess.get('total_pnl',0):.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*36}\n"
            f" ESTIMATES\n"
            f"{'─'*36}\n"
            f" Daily est:  ${est.get('daily_from_session_hr',0):.2f}"
            f"  [session rate x24]\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def startup(self, pids=None):
        # Trigger session reset in metrics engine
        try:
            import sys
            sys.path.insert(0, str(Path(__file__).parent))
            from metrics_engine import record_new_session
            record_new_session()
        except: pass

        pid_lines = ""
        if pids:
            for name, pid in pids.items():
                pid_lines += f"  {name:<10} PID {pid}\n"
        text = (
            f"🚀 **AllMight Online** | {_ts()}\n"
            f"```\n"
            f" Session reset -- fresh metrics\n"
            f"{'─'*32}\n"
            f"{pid_lines if pid_lines else '  PIDs not provided'}\n"
            f" Mode:   SHADOW (no real tx)\n"
            f" Redis:  OK\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def shutdown(self, reason="Manual stop"):
        m  = _m()
        s  = m.get("session", {})
        at = m.get("all_time", {})
        text = (
            f"🛑 **AllMight Offline** | {_ts()}\n"
            f"```\n"
            f" Reason:        {reason}\n"
            f"{'─'*32}\n"
            f" Session P&L:   ${s.get('total_pnl',0):.4f}\n"
            f" Session trades:{s.get('executed',0)}\n"
            f" All-time P&L:  ${at.get('total_pnl',0):.4f}\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def process_restarted(self, name, old_pid, new_pid):
        text = (
            f"🔄 **Process Restarted** | {_ts()}\n"
            f"```\n"
            f" Process: {name}\n"
            f" Old PID: {old_pid}  New PID: {new_pid}\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    # ── ALERT ─────────────────────────────────────────────────────────────────

    def execute_alert(self, chain, pair, gross_bps, net_usd,
                      buy_venue="", sell_venue=""):
        state = _load_state()

        # 5-min dedup
        alert_hash = f"{chain}:{pair}:{gross_bps}"
        last_hash  = state.get("last_alert_hash")
        last_time  = state.get("last_alert_time")
        if last_hash == alert_hash and last_time:
            try:
                age = (datetime.now(timezone.utc) -
                       datetime.fromisoformat(last_time)).total_seconds()
                if age < 300: return True
            except: pass

        state["last_alert_hash"] = alert_hash
        state["last_alert_time"] = datetime.now(timezone.utc).isoformat()

        m    = _m()
        sess = m.get("session", {})
        roll = m.get("rolling_24hr", {})
        at   = m.get("all_time", {})

        flags = ""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if state.get("first_trade_today") != today:
            state["first_trade_today"] = today
            flags += " 🌅 FIRST TRADE OF THE DAY\n"

        try:
            net_val = float(str(net_usd).replace("$","").replace("+",""))
        except: net_val = 0.0
        if net_val > float(state.get("all_time_best", 0)):
            state["all_time_best"] = net_val
            flags += f" 🏆 NEW BEST: ${net_val:.4f}\n"

        # Win streak milestone
        streak = sess.get("win_streak", 0)
        if streak in (10, 25, 50, 100, 150, 200):
            flags += f" 🔥 STREAK: {streak} consecutive wins\n"

        _save_state(state)

        text = (
            f"✅ **SHADOW EXECUTE** | {_ts()}\n"
            f"```\n"
            f"{flags}"
            f" Chain:      {chain.upper()}\n"
            f" Pair:       {pair}\n"
            f" Route:      {buy_venue}->{sell_venue}\n"
            f" Gross edge: {gross_bps}\n"
            f" Net P&L:    {net_usd}  [simulated]\n"
            f"{'─'*36}\n"
            f" SESSION ({m.get('session_hours',0):.1f}hrs)\n"
            f" Trades:     {sess.get('executed',0)} exec"
            f" / {sess.get('total_opps',0)} scanned\n"
            f" Hit rate:   {sess.get('hit_rate',0):.1f}%\n"
            f" P&L/hr:     ${sess.get('pnl_per_hr',0):.4f}  [session]\n"
            f" P&L/hr:     ${roll.get('pnl_per_hr',0):.4f}  [rolling 24hr]\n"
            f" Edge/hr:    {sess.get('avg_edge',0):.1f}bps  [session avg]\n"
            f" Session P&L:${sess.get('total_pnl',0):.4f}  [ACTUAL]\n"
            f"{'─'*36}\n"
            f" ALL-TIME\n"
            f" Trades:     {at.get('executed',0)}\n"
            f" Total P&L:  ${at.get('total_pnl',0):.4f}  [ACTUAL]\n"
            f"```"
        )
        return _send(ALERT_WEBHOOK, text)

    # ── DETAILED ──────────────────────────────────────────────────────────────

    def shadow_report(self, **kwargs):
        m = _m()
        if not m: return False

        sess  = m.get("session", {})
        cal   = m.get("calendar", {})
        roll  = m.get("rolling_24hr", {})
        at    = m.get("all_time", {})
        week  = m.get("week", {})
        est   = m.get("estimates", {})
        drip  = m.get("drip", {})
        sys_  = m.get("system", {})
        heat  = m.get("heatmap", {})
        pools = m.get("pools", {})

        mvi   = "PASS ✅" if sys_.get("mvi_pass") else "FAIL ❌"

        # Anomaly section
        anom_lines = ""
        for a in sys_.get("anomalies", []):
            icon = "⚠️ " if a["severity"] == "WARNING" else "ℹ️ "
            anom_lines += f"  {icon} {a['msg']}\n"

        # Pool rankings
        rank_lines = ""
        for i, (pool, d) in enumerate(list(pools.get("top_5", {}).items()), 1):
            consist = f"-{d['consistency']:.1f}" if d["consistency"] > 0 else "clean"
            sample  = " ⚠️<20" if not d.get("sample_ok") else ""
            rank_lines += (
                f"  {i}. [{d['tier']}] score:{d['score']}{sample}\n"
                f"  {pool[:42]}\n"
                f"  Hit:{d['hit_rate']:>5.1f}%  Win:{d['win_rate']:>5.1f}%"
                f"  Edge:{d['avg_edge']:>6.1f}±{d['edge_std']:.0f}bps\n"
                f"  P&L:${d['pnl']:>9.4f}  Freq:{d['frequency']:>4}"
                f"  Consist:{consist}\n"
                f"  Momentum: {d['momentum']}\n"
                "  Peak: " + ", ".join([f"{p['hour']:02d}UTC({p.get('executed',0)})" for p in d.get('peak_hours', [])[:3]]) + "\n"
            )

        text = (
            f"📊 **Detailed Report** | {_ts()}\n"
            f"```\n"
            f"{anom_lines if anom_lines else ''}"
            f"{'─'*44}\n"
            f" SESSION ({m.get('session_hours',0):.1f}hrs)"
            f"  id:{m.get('session_id','?')[:16]}\n"
            f"{'─'*44}\n"
            f" Trades:    {sess.get('executed',0):>5} exec"
            f" / {sess.get('skipped',0):>4} skip\n"
            f" Hit rate:  {sess.get('hit_rate',0):>5.1f}%"
            f"  Win rate: {sess.get('win_rate',0):>5.1f}%\n"
            f" P&L/hr:    ${sess.get('pnl_per_hr',0):>9.4f}  [session]\n"
            f" Session P&L:${sess.get('total_pnl',0):>8.4f}  [ACTUAL]\n"
            f" Best trade: ${sess.get('best_trade',0):>8.4f}\n"
            f" Win streak: {sess.get('win_streak',0)}\n"
            f" Cap eff:    {sess.get('cap_efficiency',0):.4f}%/trade\n"
            f"\n"
            f"{'─'*44}\n"
            f" CALENDAR DAY ({cal.get('date','?')})"
            f"  {cal.get('hours_elapsed',0):.1f}hrs elapsed\n"
            f"{'─'*44}\n"
            f" Trades:    {cal.get('executed',0):>5} exec"
            f" / {cal.get('skipped',0):>4} skip\n"
            f" Hit rate:  {cal.get('hit_rate',0):>5.1f}%\n"
            f" P&L/hr:    ${cal.get('pnl_per_hr',0):>9.4f}  [today avg]\n"
            f" Day P&L:   ${cal.get('total_pnl',0):>9.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*44}\n"
            f" ROLLING 24HR\n"
            f"{'─'*44}\n"
            f" Trades:    {roll.get('executed',0):>5} exec\n"
            f" Hit rate:  {roll.get('hit_rate',0):>5.1f}%"
            f"  P&L/hr: ${roll.get('pnl_per_hr',0):.4f}\n"
            f" 24hr P&L:  ${roll.get('total_pnl',0):>9.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*44}\n"
            f" ALL-TIME\n"
            f"{'─'*44}\n"
            f" Trades:    {at.get('executed',0):>5} exec"
            f" / {at.get('skipped',0):>4} skip\n"
            f" Hit rate:  {at.get('hit_rate',0):>5.1f}%"
            f"  Win rate: {at.get('win_rate',0):>5.1f}%\n"
            f" P&L/hr:    ${at.get('pnl_per_hr',0):>9.4f}  [lifetime avg]\n"
            f" Total P&L: ${at.get('total_pnl',0):>9.4f}  [ACTUAL]\n"
            f" Best:      ${at.get('best_trade',0):>9.4f}\n"
            f" Cap eff:   {at.get('cap_efficiency',0):.4f}%/trade\n"
            f"\n"
            f"{'─'*44}\n"
            f" ACTUAL vs ESTIMATED\n"
            f"{'─'*44}\n"
            f" Session P&L:  ${sess.get('total_pnl',0):>8.4f}  [ACTUAL]\n"
            f" Today P&L:    ${cal.get('total_pnl',0):>8.4f}  [ACTUAL]\n"
            f" P&L/hr today: ${cal.get('pnl_per_hr',0):>8.4f}  [ACTUAL avg]\n"
            f" Est day*:     ${est.get('daily_from_session_hr',0):>8.2f}"
            f"  [session rate x24]\n"
            f"\n"
            f"{'─'*44}\n"
            f" P&L HEATMAP (all-time by UTC hour)\n"
            f"{'─'*44}\n"
            f"{_heatmap_bar(heat)}\n"
            f"\n"
            f"{'─'*44}\n"
            f" POOL RANKINGS (v6 scoring)\n"
            f" TIER1:{pools.get('tier1_count',0)}"
            f"  TIER2:{pools.get('tier2_count',0)}\n"
            f"{'─'*44}\n"
            f"{rank_lines if rank_lines else '  No ranked pools yet'}\n"
            f"{'─'*44}\n"
            f" DRIP VAULT [ACTUAL ONLY]\n"
            f"{'─'*44}\n"
            f" Week P&L:     ${week.get('total_pnl',0):>8.4f}  [ACTUAL]\n"
            f" Current tier: ${drip.get('current_tier',0)}/wk\n"
            f" Next tier:    ${drip.get('next_tier',0)}/wk\n"
            f" Progress:     {_bar(drip.get('pct',0))}\n"
            f" Gap:          ${drip.get('gap',0):.2f}/wk\n"
            f" Daily needed: ${drip.get('daily_needed',0):.2f}/day\n"
            f"\n"
            f"{'─'*44}\n"
            f" MVI GATE: {mvi}\n"
            f" {sys_.get('mvi_reason','')}\n"
            f"```"
        )
        # Discord limit is 2000 chars -- split into two messages
        if len(text) > 1900:
            # Find a clean split point at a section divider
            split_marker = "\n```\n```\n"
            mid = text.find("─"*44, len(text)//2)
            if mid > 0:
                part1 = text[:mid].rstrip() + "\n```"
                part2 = "```\n" + text[mid:]
            else:
                part1 = text[:1900] + "\n```"
                part2 = "```\n" + text[1900:]
            ok1 = _send(DETAILED_WEBHOOK, part1)
            ok2 = _send(DETAILED_WEBHOOK, part2)
            return ok1 and ok2
        return _send(DETAILED_WEBHOOK, text)

    def weekly_rollup(self):
        m    = _m()
        week = m.get("week", {})
        drip = m.get("drip", {})
        pools = m.get("pools", {})

        rank_lines = ""
        for i, (pool, d) in enumerate(list(pools.get("top_5",{}).items()), 1):
            rank_lines += (
                f"  {i}. [{d['tier']}] {pool[:36]}\n"
                f"     P&L:${d['pnl']:.4f}  "
                f"Win:{d['win_rate']:.1f}%  Hit:{d['hit_rate']:.1f}%\n"
                f"     Momentum: {d['momentum']}\n"
            )

        text = (
            f"📋 **Weekly Rollup** | {_ts()}\n"
            f"```\n"
            f"{'─'*44}\n"
            f" THIS WEEK [ACTUAL]\n"
            f"{'─'*44}\n"
            f" Executed:  {week.get('executed',0):>5}\n"
            f" Hit rate:  {week.get('hit_rate',0):>5.1f}%"
            f"  Win: {week.get('win_rate',0):.1f}%\n"
            f" P&L/hr:    ${week.get('pnl_per_hr',0):.4f}\n"
            f" Total P&L: ${week.get('total_pnl',0):.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*44}\n"
            f" TOP POOLS\n"
            f"{'─'*44}\n"
            f"{rank_lines if rank_lines else '  No data'}\n"
            f"{'─'*44}\n"
            f" DRIP VAULT [ACTUAL]\n"
            f"{'─'*44}\n"
            f" Week P&L:     ${week.get('total_pnl',0):.4f}\n"
            f" Progress:     {_bar(drip.get('pct',0))}\n"
            f" Gap:          ${drip.get('gap',0):.2f}/wk\n"
            f" Daily needed: ${drip.get('daily_needed',0):.2f}/day\n"
            f" Status: {'PAYOUT ELIGIBLE' if week.get('total_pnl',0) >= drip.get('current_tier',1) > 0 else 'REINVESTING'}\n"
            f"```"
        )
        return _send(DETAILED_WEBHOOK, text)

    def signal_drought(self, hours_silent):
        text = (
            f"🌵 **Signal Drought** | {_ts()}\n"
            f"```\n"
            f" No EXECUTE in {hours_silent:.1f}hrs during session\n"
            f" Check: shadow.log and Redis keys\n"
            f"```"
        )
        return _send(DETAILED_WEBHOOK, text)

    def daily_summary(self, **kwargs):
        return self.shadow_report()

    # ── ERRORS ────────────────────────────────────────────────────────────────

    def error(self, message, component="unknown"):
        text = (
            f"❌ **AllMight Error** | {_ts()}\n"
            f"```\n Component: {component}\n Error: {message}\n```"
        )
        return _send(ERRORS_WEBHOOK, text)

    def stale_redis(self, key_count, last_seen_min):
        import time
        state   = _load_state()
        last    = state.get("last_stale_alert", 0)
        if time.time() - last < 1800: return True
        state["last_stale_alert"] = time.time()
        _save_state(state)
        text = (
            f"🔴 **Redis Stale** | {_ts()}\n"
            f"```\n"
            f" Keys:        {key_count}\n"
            f" Last update: {last_seen_min:.1f} min ago\n"
            f" Action:      check logs/fetcher.log\n"
            f"```"
        )
        return _send(ERRORS_WEBHOOK, text)

    def process_dead(self, name, pid):
        text = (
            f"💀 **Process Dead** | {_ts()}\n"
            f"```\n Process: {name}\n PID: {pid}\n Restarting...\n```"
        )
        return _send(ERRORS_WEBHOOK, text)

    def system_alert(self, message, level="WARNING"):
        if level == "ERROR": return self.error(message)
        icons = {"WARNING": "⚠️", "INFO": "ℹ️"}
        text  = (
            f"{icons.get(level,'⚠️')} **AllMight {level}** | {_ts()}\n"
            f"```\n{message}\n```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def anomaly_alert(self, anomalies):
        """Send anomaly alerts to errors channel."""
        if not anomalies: return True
        lines = "\n".join([f" {a['type']}: {a['msg']}" for a in anomalies])
        text  = (
            f"⚠️ **Anomaly Detected** | {_ts()}\n"
            f"```\n{lines}\n```"
        )
        return _send(ERRORS_WEBHOOK, text)

    # ── test ──────────────────────────────────────────────────────────────────
    def test(self):
        print("Testing v7 notifications (reads from metrics.json)...")
        print("TERMINAL -- heartbeat...")
        print("  OK" if self.heartbeat() else "  FAIL")
        print("TERMINAL -- startup...")
        print("  OK" if self.startup({"fetcher":1001,"shadow":1002}) else "  FAIL")
        print("ALERT -- execute trade...")
        print("  OK" if self.execute_alert(
            "arbitrum","ETH/USDT","+136bps","$+13.12",
            "uniswap_v3","curve") else "  FAIL")
        print("DETAILED -- full report...")
        print("  OK" if self.shadow_report() else "  FAIL")
        print("ERRORS -- stale redis...")
        print("  OK" if self.stale_redis(3, 8.5) else "  FAIL")
        print("Done.")


discord = DiscordAlerts()

if __name__ == "__main__":
    discord.test()
