#!/usr/bin/env python3
"""
utils/discord_alerts.py v6
Four channels, GUI-ready.

ALERT    -- trade details + session metrics (hit rate, P&L/hr, edge/hr)
DETAILED -- full analytics, combined pool rankings, actual vs estimated
TERMINAL -- heartbeat, startup, shutdown
ERRORS   -- stale Redis, crashes
"""

import os, csv, json, math, requests
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

DRIP_TIERS       = [300, 500, 800, 1300, 2000, 3200, 5000, 8000, 10000]
STATE_FILE       = Path(__file__).resolve().parent.parent / "logs/discord_state.json"
WEEKLY_SNAP_FILE = Path(__file__).resolve().parent.parent / "logs/weekly_snapshots.json"
SESSION_FILE     = Path(__file__).resolve().parent.parent / "logs/session_start.json"

# ── helpers ───────────────────────────────────────────────────────────────────

def _ts(fmt="%Y-%m-%d %H:%M UTC"):
    return datetime.now(timezone.utc).strftime(fmt)

def _bar(pct, w=10):
    f = int(pct / 100 * w)
    return "█"*f + "░"*(w-f) + f" {pct:.0f}%"

def _stddev(values):
    if len(values) < 2: return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((x - mean)**2 for x in values) / len(values))

def _drip_actual(actual_weekly_pnl):
    cur, nxt = 0, DRIP_TIERS[0]
    for i, t in enumerate(DRIP_TIERS):
        if actual_weekly_pnl >= t:
            cur = t
            nxt = DRIP_TIERS[i+1] if i+1 < len(DRIP_TIERS) else t
        else:
            nxt = t; break
    pct       = min(actual_weekly_pnl / nxt * 100, 100.0) if nxt else 100.0
    gap       = max(nxt - actual_weekly_pnl, 0)
    return {"current": cur, "next": nxt, "pct": pct,
            "gap": gap, "daily_needed": gap / 7}

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

def _get_session_start():
    """Returns session start time. Resets on system restart."""
    if SESSION_FILE.exists():
        try:
            d = json.loads(SESSION_FILE.read_text())
            return datetime.fromisoformat(d["start"])
        except: pass
    # First call -- record now as session start
    now = datetime.now(timezone.utc)
    SESSION_FILE.parent.mkdir(exist_ok=True)
    SESSION_FILE.write_text(json.dumps({"start": now.isoformat()}))
    return now

def _load_weekly_snapshots():
    if WEEKLY_SNAP_FILE.exists():
        try: return json.loads(WEEKLY_SNAP_FILE.read_text())
        except: pass
    return []

def _save_weekly_snapshot(data):
    snaps = _load_weekly_snapshots()
    snaps.append(data)
    snaps = snaps[-12:]
    WEEKLY_SNAP_FILE.parent.mkdir(exist_ok=True)
    WEEKLY_SNAP_FILE.write_text(json.dumps(snaps, indent=2))

def _load_trades(hours=None, since=None):
    """Load trades optionally filtered by hours ago or since a datetime."""
    log = Path(__file__).resolve().parent.parent / "logs/shadow_trades.csv"
    if not log.exists(): return []
    trades, cutoff = [], None
    if hours:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    elif since:
        cutoff = since
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

def _pnl_per_hr(trades, window_hours):
    """Actual P&L per hour over a given window."""
    ex   = [t for t in trades if t["decision"] == "EXECUTE"]
    pnl  = sum(float(t.get("net_profit_usd",0)) for t in ex)
    return pnl / window_hours if window_hours > 0 else 0.0

def _edge_per_hr(trades, window_hours):
    """Average gross edge bps per hour over a given window."""
    ex    = [t for t in trades if t["decision"] == "EXECUTE"]
    edges = [float(t.get("gross_edge_bps",0)) for t in ex]
    avg   = sum(edges)/len(edges) if edges else 0.0
    return avg  # edge/hr = avg edge (frequency already in freq metric)

def _stats(trades, compare_trades=None):
    """
    Full stats with v6 pool scoring.
    compare_trades: optional subset for momentum comparison (e.g. 24hr vs all)
    """
    all_opps = len(trades)
    ex       = [t for t in trades if t["decision"] == "EXECUTE"]
    skipped  = [t for t in trades if t["decision"] == "SKIP"]
    wins     = [t for t in ex if float(t.get("net_profit_usd",0)) > 0]
    pnls     = [float(t.get("net_profit_usd",0)) for t in ex]
    edges    = [float(t.get("gross_edge_bps",0)) for t in ex]
    gas_list = [float(t.get("gas_usd",0.02)) for t in trades]

    # Build comparison hit rates per pool (for momentum)
    compare_hit = {}
    if compare_trades:
        comp_pairs = {}
        for t in compare_trades:
            k = f"{t.get('chain','?')}:{t.get('pair','?')} {t.get('buy_venue','?')}->{t.get('sell_venue','?')}"
            comp_pairs.setdefault(k, {"total":0,"executed":0})
            comp_pairs[k]["total"] += 1
            if t["decision"] == "EXECUTE":
                comp_pairs[k]["executed"] += 1
        for k, d in comp_pairs.items():
            compare_hit[k] = d["executed"]/d["total"]*100 if d["total"] else 0

    # Per-pair pool quality
    pairs = {}
    for t in trades:
        k = f"{t.get('chain','?')}:{t.get('pair','?')} {t.get('buy_venue','?')}->{t.get('sell_venue','?')}"
        pairs.setdefault(k, {
            "total":0,"executed":0,"winners":0,
            "pnl":0.0,"edges":[],"gas":0.0,"hours":{}
        })
        pairs[k]["total"] += 1
        pairs[k]["gas"]   += float(t.get("gas_usd",0.02))
        try:
            hr = datetime.fromisoformat(
                t["timestamp"].replace("Z","+00:00")).hour
            pairs[k]["hours"][hr] = pairs[k]["hours"].get(hr, 0) + 1
        except: pass
        if t["decision"] == "EXECUTE":
            pairs[k]["executed"] += 1
            pairs[k]["pnl"]      += float(t.get("net_profit_usd",0))
            pairs[k]["edges"].append(float(t.get("gross_edge_bps",0)))
            if float(t.get("net_profit_usd",0)) > 0:
                pairs[k]["winners"] += 1

    ranked = {}
    for k, d in pairs.items():
        hit_rate = d["executed"] / d["total"]    * 100 if d["total"]    else 0
        win_rate = d["winners"]  / d["executed"] * 100 if d["executed"] else 0
        avg_edge = sum(d["edges"]) / len(d["edges"])   if d["edges"]    else 0
        edge_std = _stddev(d["edges"])
        frequency = d["total"]

        # Edge score -- ceiling 150bps, rewards small edges proportionally
        edge_score = min(avg_edge / 150 * 100, 100)
        freq_score = min(frequency / 100 * 100, 100)

        # Consistency penalty
        consistency_penalty = min(edge_std / 50 * 10, 10)

        # v6 scoring
        raw_score = (win_rate   * 0.30) + \
                    (hit_rate   * 0.25) + \
                    (edge_score * 0.30) + \
                    (freq_score * 0.15)
        score = max(raw_score - consistency_penalty, 0)

        # Min 20 samples before tier assigned
        if d["total"] < 20:
            tier = "UNRANKED"
        elif score >= 70: tier = "TIER 1"
        elif score >= 45: tier = "TIER 2"
        elif score >= 25: tier = "TIER 3"
        elif score >= 10: tier = "TIER 4"
        else:             tier = "TIER 4"

        # Pool momentum -- compare recent hit rate vs all-time
        recent_hit = compare_hit.get(k, None)
        if recent_hit is not None:
            diff = recent_hit - hit_rate
            if diff >= 5:    momentum = f"▲ +{diff:.1f}% (trending up)"
            elif diff <= -5: momentum = f"▼ {diff:.1f}% (slipping)"
            else:            momentum = f"→ stable ({diff:+.1f}%)"
        else:
            momentum = "→ building data"

        peak_hours = sorted(d["hours"].items(),
                           key=lambda x: x[1], reverse=True)[:3]
        peak_str = ", ".join([f"{h:02d}UTC({c})" for h, c in peak_hours])

        ranked[k] = {
            "score":       round(score, 1),
            "tier":        tier,
            "hit_rate":    round(hit_rate, 1),
            "win_rate":    round(win_rate, 1),
            "avg_edge":    round(avg_edge, 1),
            "edge_std":    round(edge_std, 1),
            "consistency": round(consistency_penalty, 1),
            "frequency":   frequency,
            "pnl":         round(d["pnl"], 4),
            "executed":    d["executed"],
            "gas_cost":    round(d["gas"], 4),
            "peak_hours":  peak_str,
            "momentum":    momentum,
            "sample_ok":   d["total"] >= 20,
        }

    return {
        "all_opps":  all_opps,
        "executed":  len(ex),
        "skipped":   len(skipped),
        "winners":   len(wins),
        "pnl":       sum(pnls),
        "best":      max(pnls) if pnls else 0.0,
        "worst":     min(pnls) if pnls else 0.0,
        "avg_edge":  sum(edges)/len(edges) if edges else 0.0,
        "edge_std":  _stddev(edges),
        "win_rate":  len(wins)/len(ex)*100  if ex       else 0.0,
        "hit_rate":  len(ex)/all_opps*100   if all_opps else 0.0,
        "gas_total": sum(gas_list),
        "ranked":    dict(sorted(ranked.items(),
                         key=lambda x: x[1]["score"], reverse=True)),
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


# ══════════════════════════════════════════════════════════════════════════════
class DiscordAlerts:
# ══════════════════════════════════════════════════════════════════════════════

    # ── TERMINAL ──────────────────────────────────────────────────────────────

    def heartbeat(self, message=""):
        all_s = _stats(_load_trades())
        hr_s  = _stats(_load_trades(hours=1))
        mvi   = all_s["win_rate"] >= 60 and all_s["executed"] >= 10
        mvi_s = "PASS ✅" if mvi else f"FAIL ❌ ({all_s['win_rate']:.0f}%)"
        hr_pnl    = hr_s["pnl"]
        daily_est = hr_pnl * 24

        text = (
            f"💚 **Heartbeat** | {_ts()}\n"
            f"```\n"
            f"{'─'*36}\n"
            f" SYSTEM\n"
            f"{'─'*36}\n"
            f" MVI Gate:     {mvi_s}\n"
            f" Total trades: {all_s['executed']}\n"
            f" Hit rate:     {all_s['hit_rate']:.1f}%\n"
            f" Win rate:     {all_s['win_rate']:.1f}%\n"
            f" All-time P&L: ${all_s['pnl']:.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*36}\n"
            f" THIS HOUR\n"
            f"{'─'*36}\n"
            f" Trades:   {hr_s['executed']} executed / {hr_s['skipped']} skipped\n"
            f" Hit rate: {hr_s['hit_rate']:.1f}%\n"
            f" P&L:      ${hr_pnl:.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*36}\n"
            f" ESTIMATES\n"
            f"{'─'*36}\n"
            f" Daily est:  ${daily_est:.2f}  [ESTIMATED]\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

    def startup(self, pids=None):
        # Reset session timer on startup
        SESSION_FILE.parent.mkdir(exist_ok=True)
        SESSION_FILE.write_text(json.dumps({
            "start": datetime.now(timezone.utc).isoformat()
        }))
        pid_lines = ""
        if pids:
            for name, pid in pids.items():
                pid_lines += f"  {name:<10} PID {pid}\n"
        text = (
            f"🚀 **AllMight Online** | {_ts()}\n"
            f"```\n"
            f" System started successfully\n"
            f"{'─'*32}\n"
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
            f" Hit rate:   {s['hit_rate']:.1f}%\n"
            f" Total P&L:  ${s['pnl']:.4f}  [ACTUAL]\n"
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

    def execute_alert(self, chain, pair, gross_bps, net_usd,
                      buy_venue="", sell_venue=""):
        """
        Trade alert -- clean and fast to read.
        Pool quality metrics removed -- see DETAILED for full pool picture.
        Session shows: hit rate, P&L/hr (rolling + session), edge/hr.
        5-min dedup per unique trade signature.
        """
        state = _load_state()

        # Deduplication
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

        # Load trade windows
        all_trades     = _load_trades()
        day_trades     = _load_trades(hours=24)
        session_start  = _get_session_start()
        session_trades = _load_trades(since=session_start)

        all_s  = _stats(all_trades)
        day_s  = _stats(day_trades)
        sess_s = _stats(session_trades)

        # P&L/hr calculations
        day_pnl_hr  = _pnl_per_hr(day_trades, 24)
        now         = datetime.now(timezone.utc)
        sess_hours  = max((now - session_start).total_seconds() / 3600, 0.01)
        sess_pnl_hr = _pnl_per_hr(session_trades, sess_hours)

        # Edge/hr (avg edge this session vs rolling 24hr)
        sess_edge = _edge_per_hr(session_trades, sess_hours)
        day_edge  = day_s["avg_edge"]

        flags = ""
        today = _ts("%Y-%m-%d")
        if state.get("first_trade_today") != today:
            state["first_trade_today"] = today
            flags += " 🌅 FIRST TRADE OF THE DAY\n"

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
            f" Route:      {buy_venue}->{sell_venue}\n"
            f" Gross edge: {gross_bps}\n"
            f" Net P&L:    {net_usd}  [simulated]\n"
            f"{'─'*34}\n"
            f" Session ({sess_hours:.1f}hrs)\n"
            f" Trades:     {sess_s['executed']} executed"
            f" / {sess_s['all_opps']} scanned\n"
            f" Hit rate:   {sess_s['hit_rate']:.1f}%\n"
            f" P&L/hr:     ${sess_pnl_hr:.4f}  [session]\n"
            f" P&L/hr:     ${day_pnl_hr:.4f}  [rolling 24hr]\n"
            f" Edge/hr:    {sess_edge:.1f}bps  [session avg]\n"
            f" Edge/hr:    {day_edge:.1f}bps  [rolling 24hr avg]\n"
            f" Total P&L:  ${sess_s['pnl']:.4f}  [session ACTUAL]\n"
            f"```"
        )
        return _send(ALERT_WEBHOOK, text)

    # ── DETAILED ──────────────────────────────────────────────────────────────

    def shadow_report(self, win_rate=None, trades=None,
                      pnl=None, mvi_pass=None):
        """
        Full hourly report.
        - Actual vs Estimated (restructured)
        - Combined pool rankings with quality metrics + momentum
        - Signal quality trend (this hour vs 24hr edge)
        - DRIP on actuals only
        """
        all_trades  = _load_trades()
        hr_trades   = _load_trades(hours=1)
        day_trades  = _load_trades(hours=24)
        week_trades = _load_trades(hours=168)

        # Stats with momentum comparison (24hr vs all-time per pool)
        all_s  = _stats(all_trades, compare_trades=day_trades)
        hr_s   = _stats(hr_trades)
        day_s  = _stats(day_trades)
        week_s = _stats(week_trades)

        mvi  = all_s["win_rate"] >= 60 and all_s["executed"] >= 10
        gate = "PASS ✅" if mvi else "FAIL ❌"

        # P&L/hr actual for today
        day_pnl_hr = _pnl_per_hr(day_trades, 24)
        hr_pnl     = hr_s["pnl"]

        # Actual vs Estimated (v6 structure)
        # ACTUAL
        actual_session_pnl = all_s["pnl"]  # all-time session
        actual_24hr_pnl    = day_s["pnl"]
        actual_pnl_hr      = day_pnl_hr
        # ESTIMATED -- only one: est P&L for the day from current hourly rate
        est_day_pnl        = hr_pnl * 24

        # Signal quality trend
        hr_edge  = hr_s["avg_edge"]
        day_edge = day_s["avg_edge"]
        if day_edge > 0:
            edge_diff = hr_edge - day_edge
            if edge_diff >= 10:
                edge_trend = f"▲ {hr_edge:.1f}bps vs {day_edge:.1f}bps 24hr avg -- expanding"
            elif edge_diff <= -10:
                edge_trend = f"▼ {hr_edge:.1f}bps vs {day_edge:.1f}bps 24hr avg -- compressing"
            else:
                edge_trend = f"→ {hr_edge:.1f}bps vs {day_edge:.1f}bps 24hr avg -- stable"
        else:
            edge_trend = f"→ {hr_edge:.1f}bps  (building baseline)"

        # WoW from snapshots
        snaps   = _load_weekly_snapshots()
        wow_str = "N/A (first week)"
        if snaps:
            prev = snaps[-1]
            diff = week_s["pnl"] - prev.get("pnl", 0)
            sign = "▲" if diff >= 0 else "▼"
            wow_str = f"{sign} ${abs(diff):.4f} vs last week"

        # DRIP on actuals
        drip = _drip_actual(week_s["pnl"])

        # Risk metrics
        gas_exposure    = all_s["gas_total"]
        est_revert_cost = all_s["skipped"] * 0.05
        net_after_gas   = all_s["pnl"] - gas_exposure

        # Combined pool rankings with quality metrics
        rank_lines = ""
        for i, (pool, d) in enumerate(list(all_s["ranked"].items())[:6], 1):
            consist = f"-{d['consistency']:.1f}pts" if d["consistency"] > 0 else "clean"
            sample_note = "" if d["sample_ok"] else " ⚠️ <20 samples"
            rank_lines += (
                f"  {'─'*40}\n"
                f"  {i}. [{d['tier']}] score:{d['score']:>5}{sample_note}\n"
                f"  {pool[:40]}\n"
                f"  Hit:{d['hit_rate']:>5.1f}%  Win:{d['win_rate']:>5.1f}%"
                f"  Freq:{d['frequency']:>4}\n"
                f"  Edge:{d['avg_edge']:>6.1f}bps ±{d['edge_std']:.0f}"
                f"  Consist:{consist}\n"
                f"  P&L:${d['pnl']:>9.4f}  Gas:${d['gas_cost']:.3f}\n"
                f"  Peak: {d['peak_hours'] or 'building...'}\n"
                f"  Momentum: {d['momentum']}\n"
            )

        wr_warn = ""
        if day_s["executed"] >= 5 and day_s["win_rate"] < 70:
            wr_warn = f" ⚠️  Win rate warning: {day_s['win_rate']:.1f}% (24hr)\n\n"

        text = (
            f"📊 **Detailed Report** | {_ts()}\n"
            f"```\n"
            f"{wr_warn}"
            f"{'─'*44}\n"
            f" ALL-TIME PERFORMANCE\n"
            f"{'─'*44}\n"
            f" Executed:    {all_s['executed']:>5}   Skipped:{all_s['skipped']:>5}\n"
            f" Hit rate:    {all_s['hit_rate']:>5.1f}%  Win rate:{all_s['win_rate']:>5.1f}%\n"
            f" Total P&L:   ${all_s['pnl']:>9.4f}  [ACTUAL]\n"
            f" Best trade:  ${all_s['best']:>9.4f}\n"
            f" Avg edge:    {all_s['avg_edge']:>8.1f}bps ±{all_s['edge_std']:.1f}\n"
            f"\n"
            f"{'─'*44}\n"
            f" ACTUAL vs ESTIMATED\n"
            f"{'─'*44}\n"
            f" ── ACTUAL ──\n"
            f" Total P&L session: ${actual_session_pnl:>8.4f}  [ACTUAL]\n"
            f" Total P&L 24hr:    ${actual_24hr_pnl:>8.4f}  [ACTUAL]\n"
            f" P&L/hr today:      ${actual_pnl_hr:>8.4f}  [ACTUAL avg]\n"
            f" ── ESTIMATED ──\n"
            f" Est P&L today:     ${est_day_pnl:>8.2f}  [hourly rate x24]\n"
            f" * projected, not guaranteed\n"
            f"\n"
            f"{'─'*44}\n"
            f" SIGNAL QUALITY TREND\n"
            f"{'─'*44}\n"
            f" {edge_trend}\n"
            f" This hour:  {hr_s['executed']} executed / {hr_s['skipped']} skipped\n"
            f"\n"
            f"{'─'*44}\n"
            f" RISK METRICS\n"
            f"{'─'*44}\n"
            f" Gas logged:      ${gas_exposure:>7.4f}  [ACTUAL ~$0.02/tx]\n"
            f" Est revert cost: ${est_revert_cost:>7.2f}  [if live ~$0.05/fail]\n"
            f" Net after gas:   ${net_after_gas:>7.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*44}\n"
            f" POOL RANKINGS (v6 scoring)\n"
            f" win:30% hit:25% edge:30% freq:15%\n"
            f"{'─'*44}\n"
            f"{rank_lines if rank_lines else '  No ranked pools yet'}\n"
            f"{'─'*44}\n"
            f" DRIP VAULT [ACTUAL ONLY]\n"
            f"{'─'*44}\n"
            f" Week actual:   ${week_s['pnl']:>8.4f}\n"
            f" WoW trend:     {wow_str}\n"
            f" Current tier:  ${drip['current']}/wk\n"
            f" Next tier:     ${drip['next']}/wk\n"
            f" Progress:      {_bar(drip['pct'])}\n"
            f" Gap:           ${drip['gap']:.2f}/wk  [ACTUAL needed]\n"
            f" Daily needed:  ${drip['daily_needed']:.2f}/day\n"
            f" Ladder: $300->$500->$800->$1300->$2000\n"
            f"\n"
            f"{'─'*44}\n"
            f" MVI GATE: {gate}\n"
            f" Win rate >= 60%: {all_s['win_rate']:.1f}%\n"
            f" Min 10 trades:   {all_s['executed']}\n"
            f"```"
        )
        return _send(DETAILED_WEBHOOK, text)

    def weekly_rollup(self):
        week_s = _stats(_load_trades(hours=168))
        drip   = _drip_actual(week_s["pnl"])
        snaps  = _load_weekly_snapshots()

        wow_str = "N/A (first week)"
        if snaps:
            prev = snaps[-1]
            diff = week_s["pnl"] - prev.get("pnl", 0)
            sign = "▲" if diff >= 0 else "▼"
            wow_str = f"{sign} ${abs(diff):.4f} vs last week"

        rank_lines = ""
        for i, (pool, d) in enumerate(list(week_s["ranked"].items())[:5], 1):
            rank_lines += (
                f"  {i}. [{d['tier']}] score:{d['score']}\n"
                f"     {pool[:38]}\n"
                f"     P&L:${d['pnl']:>8.4f}  "
                f"Win:{d['win_rate']:.1f}%  "
                f"Hit:{d['hit_rate']:.1f}%\n"
                f"     Momentum: {d['momentum']}\n"
                f"     Peak: {d['peak_hours'] or 'N/A'}\n"
            )

        text = (
            f"📋 **Weekly Rollup** | {_ts()}\n"
            f"```\n"
            f"{'─'*44}\n"
            f" THIS WEEK [ACTUAL]\n"
            f"{'─'*44}\n"
            f" Executed:    {week_s['executed']:>5}   Hit: {week_s['hit_rate']:.1f}%\n"
            f" Win rate:    {week_s['win_rate']:>5.1f}%\n"
            f" Total P&L:   ${week_s['pnl']:>9.4f}  [ACTUAL]\n"
            f" Best trade:  ${week_s['best']:>9.4f}\n"
            f" Avg edge:    {week_s['avg_edge']:>8.1f}bps\n"
            f" WoW trend:   {wow_str}\n"
            f"\n"
            f"{'─'*44}\n"
            f" TOP POOLS THIS WEEK\n"
            f"{'─'*44}\n"
            f"{rank_lines if rank_lines else '  No data'}\n"
            f"{'─'*44}\n"
            f" DRIP VAULT [ACTUAL ONLY]\n"
            f"{'─'*44}\n"
            f" Week P&L:      ${week_s['pnl']:.4f}\n"
            f" Current tier:  ${drip['current']}/wk\n"
            f" Next tier:     ${drip['next']}/wk\n"
            f" Progress:      {_bar(drip['pct'])}\n"
            f" Gap:           ${drip['gap']:.2f}/wk\n"
            f" Daily needed:  ${drip['daily_needed']:.2f}/day\n"
            f" Status:        {'PAYOUT ELIGIBLE' if week_s['pnl'] >= drip['current'] > 0 else 'REINVESTING'}\n"
            f"```"
        )

        _save_weekly_snapshot({
            "week_ending": _ts(),
            "pnl":         week_s["pnl"],
            "executed":    week_s["executed"],
            "win_rate":    week_s["win_rate"],
            "hit_rate":    week_s["hit_rate"],
        })
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
            f" No EXECUTE in {hours_silent:.1f}hrs during session\n"
            f" Check: shadow.log and Redis keys\n"
            f"```"
        )
        return _send(DETAILED_WEBHOOK, text)

    # ── ERRORS ────────────────────────────────────────────────────────────────

    def error(self, message, component="unknown"):
        text = (
            f"❌ **AllMight Error** | {_ts()}\n"
            f"```\n Component: {component}\n Error:     {message}\n```"
        )
        return _send(ERRORS_WEBHOOK, text)

    def stale_redis(self, key_count, last_seen_min):
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

    def daily_summary(self, **kwargs):
        return self.shadow_report()

    # ── test ──────────────────────────────────────────────────────────────────
    def test(self):
        print("TERMINAL -- heartbeat...")
        print("  OK" if self.heartbeat() else "  FAIL")
        print("TERMINAL -- startup...")
        print("  OK" if self.startup({"fetcher":1001,"monitor":1002,
                                       "shadow":1003,"watchdog":1004}) else "  FAIL")
        print("ALERT -- execute with session metrics + dedup...")
        r1 = self.execute_alert("arbitrum","ETH/USDT","+136bps","$+13.12",
                                 "uniswap_v3","curve")
        r2 = self.execute_alert("arbitrum","ETH/USDT","+136bps","$+13.12",
                                 "uniswap_v3","curve")
        print(f"  First: {'OK' if r1 else 'FAIL'}  "
              f"Duplicate: {'silent ✅' if r2 else 'FAIL'}")
        print("DETAILED -- full report...")
        print("  OK" if self.shadow_report() else "  FAIL")
        print("ERRORS -- stale redis...")
        print("  OK" if self.stale_redis(3, 8.5) else "  FAIL")
        print("All done.")


discord = DiscordAlerts()

if __name__ == "__main__":
    discord.test()
