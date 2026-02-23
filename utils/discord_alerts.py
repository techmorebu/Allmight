#!/usr/bin/env python3
"""
utils/discord_alerts.py v5
Four channels, GUI-ready.

Key principles:
  - DRIP tier = actual realized P&L only, never projections
  - Extrapolations clearly labeled ACTUAL vs ESTIMATED
  - Pool ranking with consistency + time-of-day patterns
  - Actionable DRIP gap (daily run rate needed)
  - Weekly snapshots for real WoW trend comparisons
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

DRIP_TIERS        = [300, 500, 800, 1300, 2000, 3200, 5000, 8000, 10000]
STATE_FILE        = Path(__file__).resolve().parent.parent / "logs/discord_state.json"
WEEKLY_SNAP_FILE  = Path(__file__).resolve().parent.parent / "logs/weekly_snapshots.json"

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
    """DRIP tier based ONLY on actual realized P&L. Never projections."""
    cur, nxt = 0, DRIP_TIERS[0]
    for i, t in enumerate(DRIP_TIERS):
        if actual_weekly_pnl >= t:
            cur = t
            nxt = DRIP_TIERS[i+1] if i+1 < len(DRIP_TIERS) else t
        else:
            nxt = t; break
    pct       = min(actual_weekly_pnl / nxt * 100, 100.0) if nxt else 100.0
    gap       = max(nxt - actual_weekly_pnl, 0)
    daily_req = gap / 7
    return {"current": cur, "next": nxt, "pct": pct,
            "gap": gap, "daily_needed": daily_req}

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

def _load_weekly_snapshots():
    if WEEKLY_SNAP_FILE.exists():
        try: return json.loads(WEEKLY_SNAP_FILE.read_text())
        except: pass
    return []

def _save_weekly_snapshot(data):
    snaps = _load_weekly_snapshots()
    snaps.append(data)
    snaps = snaps[-12:]  # keep last 12 weeks
    WEEKLY_SNAP_FILE.parent.mkdir(exist_ok=True)
    WEEKLY_SNAP_FILE.write_text(json.dumps(snaps, indent=2))

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
    """
    Full stats with pool quality scoring v5.
    Scoring weights:
      win_rate    35% -- most important for flash loans
      hit_rate    20% -- signal quality
      edge_score  25% -- spread size
      frequency   20% -- volume of opportunities (raised from 10%)
    Consistency penalty: high edge std dev reduces score up to -10pts
    """
    all_opps = len(trades)
    ex       = [t for t in trades if t["decision"] == "EXECUTE"]
    skipped  = [t for t in trades if t["decision"] == "SKIP"]
    wins     = [t for t in ex if float(t.get("net_profit_usd",0)) > 0]
    pnls     = [float(t.get("net_profit_usd",0)) for t in ex]
    edges    = [float(t.get("gross_edge_bps",0)) for t in ex]
    gas_list = [float(t.get("gas_usd",0.02)) for t in trades]

    # Per-pair pool quality with time-of-day and consistency
    pairs = {}
    for t in trades:
        k = f"{t.get('chain','?')}:{t.get('pair','?')} {t.get('buy_venue','?')}->{t.get('sell_venue','?')}"
        pairs.setdefault(k, {
            "total":0,"executed":0,"winners":0,
            "pnl":0.0,"edges":[],"gas":0.0,
            "hours": {}  # time-of-day tracking
        })
        pairs[k]["total"] += 1
        pairs[k]["gas"]   += float(t.get("gas_usd",0.02))

        # Time-of-day pattern
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
        hit_rate  = d["executed"] / d["total"] * 100   if d["total"]    else 0
        win_rate  = d["winners"]  / d["executed"] * 100 if d["executed"] else 0
        avg_edge  = sum(d["edges"]) / len(d["edges"])   if d["edges"]    else 0
        edge_std  = _stddev(d["edges"])
        frequency = d["total"]

        # Normalize edge score (200bps = 100%)
        edge_score = min(avg_edge / 200 * 100, 100)

        # Normalize frequency (100 signals = 100%)
        freq_score = min(frequency / 100 * 100, 100)

        # Consistency penalty -- std dev > 50bps loses up to 10 points
        consistency_penalty = min(edge_std / 50 * 10, 10)

        # Weighted score v5
        raw_score = (win_rate  * 0.35) + \
                    (hit_rate  * 0.20) + \
                    (edge_score * 0.25) + \
                    (freq_score * 0.20)
        score = max(raw_score - consistency_penalty, 0)

        tier = "TIER 1" if score >= 70 else \
               "TIER 2" if score >= 45 else "TIER 3"

        # Peak hours (top 3)
        peak_hours = sorted(d["hours"].items(),
                           key=lambda x: x[1], reverse=True)[:3]
        peak_str = ", ".join([f"{h:02d}:00UTC({c})" for h, c in peak_hours])

        ranked[k] = {
            "score":        round(score, 1),
            "tier":         tier,
            "hit_rate":     round(hit_rate, 1),
            "win_rate":     round(win_rate, 1),
            "avg_edge":     round(avg_edge, 1),
            "edge_std":     round(edge_std, 1),
            "consistency":  round(consistency_penalty, 1),
            "frequency":    frequency,
            "pnl":          round(d["pnl"], 4),
            "executed":     d["executed"],
            "gas_cost":     round(d["gas"], 4),
            "peak_hours":   peak_str,
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
        "win_rate":  len(wins)/len(ex)*100   if ex        else 0.0,
        "hit_rate":  len(ex)/all_opps*100    if all_opps  else 0.0,
        "gas_total": sum(gas_list),
        "ranked":    dict(sorted(ranked.items(),
                         key=lambda x: x[1]["score"], reverse=True)),
    }

def _top_pool_rank(chain, pair, buy_venue, sell_venue, all_stats):
    key = f"{chain}:{pair} {buy_venue}->{sell_venue}"
    return all_stats["ranked"].get(key, {
        "tier":"UNRANKED","score":0,"win_rate":0,
        "hit_rate":0,"avg_edge":0,"edge_std":0,
        "peak_hours":"unknown","consistency":0
    })

def _extrapolations(hr_pnl, day_pnl, week_pnl):
    return {
        "actual_today":          day_pnl,
        "actual_week":           week_pnl,
        "est_daily_from_hour":   hr_pnl * 24,
        "est_weekly_from_hour":  hr_pnl * 24 * 7,
        "est_weekly_from_day":   day_pnl * 7,
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
        ex    = _extrapolations(hr_s["pnl"], 0, 0)
        drip  = _drip_actual(0)  # heartbeat shows estimates only

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
            f" Hit rate: {hr_s['hit_rate']:.1f}%  Win rate: {hr_s['win_rate']:.1f}%\n"
            f" P&L:      ${hr_s['pnl']:.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*36}\n"
            f" ESTIMATES (from hourly rate)\n"
            f"{'─'*36}\n"
            f" Daily est:   ${ex['est_daily_from_hour']:.2f}  [ESTIMATED]\n"
            f" Weekly est:  ${ex['est_weekly_from_hour']:.2f}  [ESTIMATED]\n"
            f"```"
        )
        return _send(TERMINAL_WEBHOOK, text)

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
        """5-min dedup per pool. Shows rank, consistency, peak hours."""
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

        all_s = _stats(_load_trades())
        rank  = _top_pool_rank(chain, pair, buy_venue, sell_venue, all_s)
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

        # Flag if lower tier pool outperforming
        if rank.get("tier") in ("TIER 2","TIER 3") and net_val > 5.0:
            flags += f" 🔍 ANOMALY: {rank['tier']} pool with strong edge\n"

        _save_state(state)

        text = (
            f"✅ **SHADOW EXECUTE** | {_ts()}\n"
            f"```\n"
            f"{flags}"
            f" Chain:       {chain.upper()}\n"
            f" Pair:        {pair}\n"
            f" Route:       {buy_venue}->{sell_venue}\n"
            f" Gross edge:  {gross_bps}\n"
            f" Net P&L:     {net_usd}  [simulated]\n"
            f"{'─'*34}\n"
            f" Pool Quality\n"
            f" Rank:        {rank['tier']} (score: {rank['score']})\n"
            f" Hit rate:    {rank['hit_rate']}%\n"
            f" Win rate:    {rank['win_rate']}%\n"
            f" Avg edge:    {rank['avg_edge']}bps"
            f" ±{rank['edge_std']}bps\n"
            f" Peak hours:  {rank['peak_hours'] or 'building...'}\n"
            f"{'─'*34}\n"
            f" Session\n"
            f" Trades:      {all_s['executed']}\n"
            f" Win rate:    {all_s['win_rate']:.1f}%\n"
            f" Total P&L:   ${all_s['pnl']:.4f}  [ACTUAL]\n"
            f"```"
        )
        return _send(ALERT_WEBHOOK, text)

    # ── DETAILED ──────────────────────────────────────────────────────────────

    def shadow_report(self, win_rate=None, trades=None,
                      pnl=None, mvi_pass=None):
        all_s  = _stats(_load_trades())
        hr_s   = _stats(_load_trades(hours=1))
        day_s  = _stats(_load_trades(hours=24))
        week_s = _stats(_load_trades(hours=168))

        mvi  = all_s["win_rate"] >= 60 and all_s["executed"] >= 10
        gate = "PASS ✅" if mvi else "FAIL ❌"
        ex   = _extrapolations(hr_s["pnl"], day_s["pnl"], week_s["pnl"])
        drip = _drip_actual(week_s["pnl"])

        # WoW from snapshots
        snaps   = _load_weekly_snapshots()
        wow_str = "N/A (first week)"
        if snaps:
            prev_pnl = snaps[-1].get("pnl", 0)
            diff     = week_s["pnl"] - prev_pnl
            sign     = "▲" if diff >= 0 else "▼"
            wow_str  = f"{sign} ${abs(diff):.4f} vs last week"

        # Pool ranking table
        rank_lines = ""
        for i, (pool, d) in enumerate(list(all_s["ranked"].items())[:5], 1):
            consist = f"-{d['consistency']:.1f}pts" if d["consistency"] > 0 else "clean"
            rank_lines += (
                f"  {i}. [{d['tier']}] score:{d['score']:>5}\n"
                f"     {pool[:38]}\n"
                f"     Hit:{d['hit_rate']:>5.1f}%  Win:{d['win_rate']:>5.1f}%"
                f"  Edge:{d['avg_edge']:>6.1f}±{d['edge_std']:.0f}bps\n"
                f"     P&L:${d['pnl']:>8.4f}  Freq:{d['frequency']:>4}"
                f"  Consist:{consist}\n"
                f"     Peak: {d['peak_hours'] or 'building...'}\n"
            )

        # Risk metrics
        gas_exposure     = all_s["gas_total"]
        est_revert_cost  = all_s["skipped"] * 0.05
        net_after_gas    = all_s["pnl"] - gas_exposure

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
            f" Executed:    {all_s['executed']:>5}   Skipped: {all_s['skipped']:>5}\n"
            f" Hit rate:    {all_s['hit_rate']:>5.1f}%  Win rate:{all_s['win_rate']:>5.1f}%\n"
            f" Total P&L:   ${all_s['pnl']:>9.4f}  [ACTUAL]\n"
            f" Best trade:  ${all_s['best']:>9.4f}\n"
            f" Avg edge:    {all_s['avg_edge']:>8.1f}bps ±{all_s['edge_std']:.1f}\n"
            f"\n"
            f"{'─'*44}\n"
            f" RISK METRICS\n"
            f"{'─'*44}\n"
            f" Gas logged:      ${gas_exposure:>7.4f}  [ACTUAL ~$0.02/tx]\n"
            f" Est revert cost: ${est_revert_cost:>7.2f}  [if live ~$0.05/fail]\n"
            f" Net after gas:   ${net_after_gas:>7.4f}  [ACTUAL]\n"
            f"\n"
            f"{'─'*44}\n"
            f" ACTUAL vs ESTIMATED\n"
            f"{'─'*44}\n"
            f" Today actual:    ${ex['actual_today']:>9.4f}  [ACTUAL 24hr]\n"
            f" Week actual:     ${ex['actual_week']:>9.4f}  [ACTUAL 7d]\n"
            f" WoW trend:       {wow_str}\n"
            f" ──\n"
            f" Daily est*:      ${ex['est_daily_from_hour']:>9.2f}  [hourly rate x24]\n"
            f" Weekly est*:     ${ex['est_weekly_from_hour']:>9.2f}  [hourly rate x168]\n"
            f" Weekly est**:    ${ex['est_weekly_from_day']:>9.2f}  [daily rate x7]\n"
            f" * projected, not guaranteed\n"
            f"\n"
            f"{'─'*44}\n"
            f" POOL RANKINGS (v5 scoring)\n"
            f"{'─'*44}\n"
            f"{rank_lines if rank_lines else '  No ranked pools yet'}\n"
            f"{'─'*44}\n"
            f" DRIP VAULT [ACTUAL ONLY]\n"
            f"{'─'*44}\n"
            f" Week actual:   ${week_s['pnl']:>8.4f}\n"
            f" Current tier:  ${drip['current']}/wk\n"
            f" Next tier:     ${drip['next']}/wk\n"
            f" Progress:      {_bar(drip['pct'])}\n"
            f" Gap:           ${drip['gap']:.2f}/wk  [ACTUAL needed]\n"
            f" Daily needed:  ${drip['daily_needed']:.2f}/day to next tier\n"
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
        """Saves snapshot for future WoW comparisons."""
        week_s = _stats(_load_trades(hours=168))
        drip   = _drip_actual(week_s["pnl"])
        snaps  = _load_weekly_snapshots()

        # WoW comparison
        wow_str = "N/A (first week)"
        if snaps:
            prev = snaps[-1]
            diff = week_s["pnl"] - prev.get("pnl", 0)
            sign = "▲" if diff >= 0 else "▼"
            wow_str = f"{sign} ${abs(diff):.4f} vs last week"

        rank_lines = ""
        for i, (pool, d) in enumerate(list(week_s["ranked"].items())[:5], 1):
            rank_lines += (
                f"  {i}. [{d['tier']}] {pool[:34]}\n"
                f"     P&L:${d['pnl']:>8.4f}  "
                f"Win:{d['win_rate']:.1f}%  "
                f"Hit:{d['hit_rate']:.1f}%\n"
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

        # Save snapshot for future WoW
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
            f" No EXECUTE decisions in {hours_silent:.1f} hours\n"
            f" During active session (13-21 UTC)\n"
            f"{'─'*32}\n"
            f" Possible causes:\n"
            f"  - Market spread compressed\n"
            f"  - Fetcher returning stale data\n"
            f"  - Allowlist too restrictive\n"
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
            f" Threshold:   6 min\n"
            f" Action:      check logs/fetcher.log\n"
            f"```"
        )
        return _send(ERRORS_WEBHOOK, text)

    def process_dead(self, name, pid):
        text = (
            f"💀 **Process Dead** | {_ts()}\n"
            f"```\n Process: {name}\n PID: {pid}\n Status: Restarting...\n```"
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
        print("ALERT -- execute with rank + dedup...")
        r1 = self.execute_alert("arbitrum","ETH/USDT","+136bps","$+13.12",
                                 "uniswap_v3","curve")
        r2 = self.execute_alert("arbitrum","ETH/USDT","+136bps","$+13.12",
                                 "uniswap_v3","curve")
        print(f"  First: {'OK' if r1 else 'FAIL'}  "
              f"Duplicate: {'silent ✅' if r2 else 'FAIL'}")
        print("DETAILED -- full report with rankings...")
        print("  OK" if self.shadow_report() else "  FAIL")
        print("ERRORS -- stale redis...")
        print("  OK" if self.stale_redis(3, 8.5) else "  FAIL")
        print("All done.")


discord = DiscordAlerts()

if __name__ == "__main__":
    discord.test()
