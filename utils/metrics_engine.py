#!/usr/bin/env python3
"""
utils/metrics_engine.py
Central metrics engine for AllMight.

Single source of truth for all notifications, future GUI, charts, DB.
Runs as a background thread, updates metrics.json every 60 seconds.
All notifications read from metrics.json -- zero independent calculations.

Schema is SQLite-ready for future migration.

Metrics tracked:
  SESSION     -- resets on every restart, tied to session_id
  CALENDAR    -- 12am-11:59pm UTC daily buckets
  ROLLING     -- sliding 24hr window
  ALL_TIME    -- cumulative across all sessions
  HEATMAP     -- per UTC hour: trades, P&L, hit rate, avg edge
  ANOMALIES   -- drift detection, velocity changes, streak tracking
"""

import csv, json, math, os, threading, time
from datetime import datetime, timezone, timedelta
from pathlib import Path


ROOT         = Path(__file__).resolve().parent.parent
CSV_PATH     = ROOT / "logs/shadow_trades.csv"
METRICS_PATH = ROOT / "logs/metrics.json"
SESSION_PATH = ROOT / "logs/session_start.json"
SCHEMA_VER   = 4  # increment when schema changes

# ── helpers ───────────────────────────────────────────────────────────────────

def _now():
    return datetime.now(timezone.utc)

def _ts(dt=None):
    return (dt or _now()).strftime("%Y-%m-%dT%H:%M:%SZ")

def _day_start(dt=None):
    """12:00:00am UTC for the given datetime."""
    d = (dt or _now()).date()
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)

def _stddev(values):
    if len(values) < 2: return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((x - mean)**2 for x in values) / len(values))

def _pct(a, b):
    return round(a / b * 100, 2) if b else 0.0

def _get_session_start():
    if SESSION_PATH.exists():
        try:
            d = json.loads(SESSION_PATH.read_text())
            _s = datetime.fromisoformat(d["start"])
            if _s.tzinfo is None: _s = _s.replace(tzinfo=timezone.utc)
            return _s.astimezone(timezone.utc), d.get("session_id", d["start"])
        except: pass
    now = _now()
    sid = _ts(now)
    SESSION_PATH.parent.mkdir(exist_ok=True)
    SESSION_PATH.write_text(json.dumps({"start": now.isoformat(), "session_id": sid}))
    return now, sid

def _record_session_start():
    """Called on startup to reset session."""
    now = _now()
    sid = _ts(now)
    SESSION_PATH.parent.mkdir(exist_ok=True)
    SESSION_PATH.write_text(json.dumps({"start": now.isoformat(), "session_id": sid}))
    return now, sid

# ── CSV loader ────────────────────────────────────────────────────────────────

def _load_all_trades():
    if not CSV_PATH.exists(): return []
    trades = []
    with open(CSV_PATH) as f:
        for row in csv.DictReader(f):
            if not row.get("decision"): continue
            try:
                _raw = datetime.fromisoformat(
                    row["timestamp"].replace("Z", "+00:00"))
                # Force UTC if naive
                if _raw.tzinfo is None:
                    _raw = _raw.replace(tzinfo=timezone.utc)
                row["_ts"] = _raw.astimezone(timezone.utc)
                row["_pnl"]  = float(row.get("net_profit_usd", 0))
                row["_edge"] = float(row.get("gross_edge_bps", 0))
                row["_gas"]  = float(row.get("gas_usd", 0.02))
                trades.append(row)
            except: continue
    return trades

def _filter(trades, since=None, until=None):
    result = []
    for t in trades:
        if since and t["_ts"] < since: continue
        if until and t["_ts"] > until: continue
        result.append(t)
    return result

# ── core stats from trade list ────────────────────────────────────────────────

def _core_stats(trades, window_hours=None):
    """Compute core stats from a filtered trade list."""
    ex      = [t for t in trades if t["decision"] == "EXECUTE"]
    skipped = [t for t in trades if t["decision"] == "SKIP"]
    wins    = [t for t in ex if t["_pnl"] > 0]
    pnls    = [t["_pnl"]  for t in ex]
    edges   = [t["_edge"] for t in ex]
    gas     = [t["_gas"]  for t in trades]

    total_pnl  = sum(pnls)
    total_gas  = sum(gas)
    pnl_net    = total_pnl - total_gas
    avg_edge   = sum(edges) / len(edges) if edges else 0.0
    edge_std   = _stddev(edges)

    # P&L per hour
    if window_hours and window_hours > 0:
        pnl_hr = total_pnl / window_hours
    else:
        pnl_hr = 0.0

    # Capital efficiency: P&L per $1000 deployed
    # Each trade = $1000 flash loan (shadow assumption)
    cap_eff = total_pnl / (len(ex) * 1000) * 100 if ex else 0.0

    # Consecutive streak
    streak = 0
    for t in reversed(ex):
        if t["_pnl"] > 0: streak += 1
        else: break

    return {
        "total_opps":     len(trades),
        "executed":       len(ex),
        "skipped":        len(skipped),
        "winners":        len(wins),
        "win_rate":       _pct(len(wins), len(ex)),
        "hit_rate":       _pct(len(ex), len(trades)),
        "total_pnl":      round(total_pnl, 6),
        "total_gas":      round(total_gas, 6),
        "net_pnl":        round(pnl_net, 6),
        "best_trade":     round(max(pnls), 6) if pnls else 0.0,
        "worst_trade":    round(min(pnls), 6) if pnls else 0.0,
        "avg_pnl":        round(total_pnl / len(ex), 6) if ex else 0.0,
        "avg_edge":       round(avg_edge, 2),
        "edge_std":       round(edge_std, 2),
        "pnl_per_hr":     round(pnl_hr, 6),
        "cap_efficiency": round(cap_eff, 4),
        "win_streak":     streak,
    }

# ── heatmap (per UTC hour) ────────────────────────────────────────────────────

def _build_heatmap(trades):
    """
    24-bucket heatmap (0-23 UTC).
    Each bucket: trades, executed, P&L, hit_rate, avg_edge, pnl_per_trade
    """
    buckets = {h: {"total":0,"executed":0,"pnl":0.0,"edges":[]} 
               for h in range(24)}
    for t in trades:
        h = t["_ts"].hour
        buckets[h]["total"] += 1
        if t["decision"] == "EXECUTE":
            buckets[h]["executed"] += 1
            buckets[h]["pnl"]      += t["_pnl"]
            buckets[h]["edges"].append(t["_edge"])

    heatmap = {}
    for h, d in buckets.items():
        avg_edge = sum(d["edges"])/len(d["edges"]) if d["edges"] else 0.0
        heatmap[h] = {
            "total":         d["total"],
            "executed":      d["executed"],
            "hit_rate":      _pct(d["executed"], d["total"]),
            "total_pnl":     round(d["pnl"], 6),
            "avg_edge":      round(avg_edge, 2),
            "pnl_per_trade": round(d["pnl"]/d["executed"], 6) if d["executed"] else 0.0,
        }
    return heatmap

def _best_hours(heatmap, n=3):
    """Top N hours by total P&L."""
    ranked = sorted(
        [(h, d) for h, d in heatmap.items() if d["executed"] > 0],
        key=lambda x: x[1]["total_pnl"], reverse=True
    )[:n]
    return [{"hour": h, **d} for h, d in ranked]

# ── anomaly detection ─────────────────────────────────────────────────────────

def _anomalies(all_time, rolling_24, session, heatmap):
    flags = []

    # Hit rate declining
    if rolling_24["hit_rate"] < all_time["hit_rate"] * 0.7 and all_time["executed"] > 20:
        flags.append({
            "type": "HIT_RATE_DECLINE",
            "msg":  f"Hit rate dropped: {rolling_24['hit_rate']}% (24hr) "
                    f"vs {all_time['hit_rate']}% (all-time)",
            "severity": "WARNING"
        })

    # P&L/hr declining >30%
    if (all_time["pnl_per_hr"] > 0 and session["pnl_per_hr"] > 0 and
            session["pnl_per_hr"] < all_time["pnl_per_hr"] * 0.7):
        flags.append({
            "type": "PNL_RATE_DECLINE",
            "msg":  f"P&L/hr down >30%: ${session['pnl_per_hr']:.4f}/hr "
                    f"vs ${all_time['pnl_per_hr']:.4f}/hr all-time",
            "severity": "WARNING"
        })

    # Trade velocity drop -- if last hour had 0 executed during active hours
    now_hr = _now().hour
    if 13 <= now_hr <= 21:  # typical active window UTC
        this_hr = heatmap.get(now_hr, {})
        if this_hr.get("total", 0) == 0:
            flags.append({
                "type": "VELOCITY_DROP",
                "msg":  f"Zero trades scanned at hour {now_hr:02d}UTC (active window)",
                "severity": "WARNING"
            })

    # Win streak milestone
    if session["win_streak"] in (10, 25, 50, 100):
        flags.append({
            "type": "STREAK_MILESTONE",
            "msg":  f"Win streak: {session['win_streak']} consecutive profitable trades",
            "severity": "INFO"
        })

    return flags

# ── pool quality scoring (v6) ─────────────────────────────────────────────────

def _pool_scores(trades, compare_trades=None):
    """Per-pool quality scoring with momentum."""
    pairs = {}
    for t in trades:
        k = (f"{t.get('chain','?')}:{t.get('pair','?')} "
             f"{t.get('buy_venue','?')}->{t.get('sell_venue','?')}")
        pairs.setdefault(k, {
            "total":0,"executed":0,"winners":0,
            "pnl":0.0,"edges":[],"gas":0.0,"hours":{}
        })
        pairs[k]["total"] += 1
        pairs[k]["gas"]   += t["_gas"]
        h = t["_ts"].hour
        pairs[k]["hours"][h] = pairs[k]["hours"].get(h, 0) + 1
        if t["decision"] == "EXECUTE":
            pairs[k]["executed"] += 1
            pairs[k]["pnl"]      += t["_pnl"]
            pairs[k]["edges"].append(t["_edge"])
            if t["_pnl"] > 0:
                pairs[k]["winners"] += 1

    # comparison hit rates for momentum
    comp_hit = {}
    if compare_trades:
        cp = {}
        for t in compare_trades:
            k = (f"{t.get('chain','?')}:{t.get('pair','?')} "
                 f"{t.get('buy_venue','?')}->{t.get('sell_venue','?')}")
            cp.setdefault(k, {"total":0,"executed":0})
            cp[k]["total"] += 1
            if t["decision"] == "EXECUTE": cp[k]["executed"] += 1
        for k, d in cp.items():
            comp_hit[k] = _pct(d["executed"], d["total"])

    ranked = {}
    for k, d in pairs.items():
        hit  = _pct(d["executed"], d["total"])
        win  = _pct(d["winners"],  d["executed"])
        avg_edge  = sum(d["edges"])/len(d["edges"]) if d["edges"] else 0.0
        edge_std  = _stddev(d["edges"])
        freq      = d["total"]

        edge_score = min(avg_edge / 150 * 100, 100)
        freq_score = min(freq / 100 * 100, 100)
        penalty    = min(edge_std / 50 * 10, 10)
        raw_score  = (win * 0.30) + (hit * 0.25) + \
                     (edge_score * 0.30) + (freq_score * 0.15)
        score = max(raw_score - penalty, 0)

        if d["total"] < 20:           tier = "UNRANKED"
        elif score >= 70:             tier = "TIER 1"
        elif score >= 45:             tier = "TIER 2"
        elif score >= 25:             tier = "TIER 3"
        else:                         tier = "TIER 4"

        recent_hit = comp_hit.get(k)
        if recent_hit is not None:
            diff = recent_hit - hit
            if diff >= 5:    momentum = f"UP +{diff:.1f}%"
            elif diff <= -5: momentum = f"DOWN {diff:.1f}%"
            else:            momentum = f"STABLE {diff:+.1f}%"
        else:
            momentum = "BUILDING"

        peak = sorted(d["hours"].items(), key=lambda x: x[1], reverse=True)[:3]
        ranked[k] = {
            "score":       round(score, 1),
            "tier":        tier,
            "hit_rate":    round(hit, 2),
            "win_rate":    round(win, 2),
            "avg_edge":    round(avg_edge, 2),
            "edge_std":    round(edge_std, 2),
            "consistency": round(penalty, 2),
            "frequency":   freq,
            "pnl":         round(d["pnl"], 6),
            "executed":    d["executed"],
            "gas_cost":    round(d["gas"], 6),
            "peak_hours":  [{"hour": h, "count": c} for h, c in peak],
            "momentum":    momentum,
            "sample_ok":   d["total"] >= 20,
        }

    return dict(sorted(ranked.items(),
                       key=lambda x: x[1]["score"], reverse=True))

# ── DRIP vault ────────────────────────────────────────────────────────────────

DRIP_TIERS = [300, 500, 800, 1300, 2000, 3200, 5000, 8000, 10000]

def _drip(actual_weekly_pnl):
    cur, nxt = 0, DRIP_TIERS[0]
    for i, t in enumerate(DRIP_TIERS):
        if actual_weekly_pnl >= t:
            cur = t
            nxt = DRIP_TIERS[i+1] if i+1 < len(DRIP_TIERS) else t
        else:
            nxt = t; break
    gap = max(nxt - actual_weekly_pnl, 0)
    return {
        "current_tier": cur,
        "next_tier":    nxt,
        "pct":          round(min(actual_weekly_pnl / nxt * 100, 100), 2) if nxt else 100,
        "gap":          round(gap, 4),
        "daily_needed": round(gap / 7, 4),
    }

# ── MAIN CALCULATION ──────────────────────────────────────────────────────────

def calculate_metrics():
    now              = _now()
    session_start, session_id = _get_session_start()
    day_start        = _day_start(now)
    rolling_start    = now - timedelta(hours=24)
    week_start       = now - timedelta(hours=168)

    session_hrs = max((now - session_start).total_seconds() / 3600, 0.001)
    day_hrs     = max((now - day_start).total_seconds() / 3600, 0.001)

    all_trades = _load_all_trades()

    # Filtered subsets
    session_trades = _filter(all_trades, since=session_start)
    day_trades     = _filter(all_trades, since=day_start, until=day_start + timedelta(hours=24))
    rolling_trades = _filter(all_trades, since=rolling_start)
    week_trades    = _filter(all_trades, since=week_start)

    # Core stats
    all_stats     = _core_stats(all_trades)
    session_stats = _core_stats(session_trades, session_hrs)
    day_stats     = _core_stats(day_trades, day_hrs)
    rolling_stats = _core_stats(rolling_trades, 24)
    week_stats    = _core_stats(week_trades, 168)

    # All-time P&L/hr (total P&L / total hours since first trade)
    if all_trades:
        first_ts = min(t["_ts"] for t in all_trades)
        total_hrs = max((now - first_ts).total_seconds() / 3600, 0.001)
        all_stats["pnl_per_hr"] = round(all_stats["total_pnl"] / total_hrs, 6)

    # Heatmap from all trades + best hours
    heatmap    = _build_heatmap(all_trades)
    best_hours = _best_hours(heatmap)

    # Session best hour
    sess_heatmap    = _build_heatmap(session_trades)
    sess_best_hours = _best_hours(sess_heatmap, n=1)
    session_stats["best_hour"] = sess_best_hours[0] if sess_best_hours else None

    # Pool rankings
    pools = _pool_scores(all_trades, compare_trades=rolling_trades)

    # Anomalies
    anomalies = _anomalies(all_stats, rolling_stats, session_stats, sess_heatmap)

    # DRIP
    drip = _drip(week_stats["total_pnl"])

    # MVI gate
    mvi_pass = (all_stats["win_rate"] >= 60 and all_stats["executed"] >= 10)

    metrics = {
        "schema_version":  SCHEMA_VER,
        "generated_at":    _ts(now),
        "session_id":      session_id,
        "session_start":   _ts(session_start),
        "session_hours":   round(session_hrs, 2),

        # ── Four metric groups ──────────────────────────────────────
        "session":  session_stats,
        "calendar": {
            "date":       now.strftime("%Y-%m-%d"),
            "day_start":  _ts(day_start),
            "hours_elapsed": round(day_hrs, 2),
            **day_stats,
        },
        "rolling_24hr": rolling_stats,
        "all_time":     all_stats,
        "week":         week_stats,

        # ── Heatmap ─────────────────────────────────────────────────
        "heatmap": {
            "by_hour":    heatmap,
            "best_hours": best_hours,
            "current_hour": now.hour,
        },

        # ── Pool intelligence ────────────────────────────────────────
        "pools": {
            "ranked":     pools,
            "top_5":      dict(list(pools.items())[:5]),
            "tier1_count": sum(1 for p in pools.values() if p["tier"] == "TIER 1"),
            "tier2_count": sum(1 for p in pools.values() if p["tier"] == "TIER 2"),
        },

        # ── System ──────────────────────────────────────────────────
        "system": {
            "mvi_pass":    mvi_pass,
            "mvi_reason":  (
                f"win_rate={all_stats['win_rate']}% "
                f"trades={all_stats['executed']}"
            ),
            "anomalies":   anomalies,
            "anomaly_count": len(anomalies),
        },

        # ── DRIP ────────────────────────────────────────────────────
        "drip": drip,

        # ── Estimates (clearly labeled) ──────────────────────────────
        "estimates": {
            "daily_from_session_hr":  round(session_stats["pnl_per_hr"] * 24, 4),
            "daily_from_rolling_hr":  round(rolling_stats["pnl_per_hr"] * 24, 4),
            "weekly_from_day":        round(day_stats["total_pnl"] * 7, 4),
        },
    }

    return metrics

# ── writer ────────────────────────────────────────────────────────────────────

def write_metrics():
    try:
        m = calculate_metrics()
        METRICS_PATH.parent.mkdir(exist_ok=True)
        # Atomic write -- write to temp then rename
        tmp = METRICS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(m, indent=2))
        tmp.rename(METRICS_PATH)
        return m
    except Exception as e:
        print(f"[metrics_engine] ERROR: {e}")
        return None

def read_metrics():
    """Fast read for notification modules."""
    if METRICS_PATH.exists():
        try: return json.loads(METRICS_PATH.read_text())
        except: pass
    # Fallback: calculate fresh
    return write_metrics()

# ── background thread ─────────────────────────────────────────────────────────

class MetricsEngine(threading.Thread):
    def __init__(self, interval=60):
        super().__init__(daemon=True)
        self.interval = interval
        self._stop    = threading.Event()

    def run(self):
        print(f"[metrics_engine] Started (updating every {self.interval}s)")
        while not self._stop.is_set():
            m = write_metrics()
            if m:
                anom = m["system"]["anomaly_count"]
                print(f"[metrics_engine] Updated -- "
                      f"session P&L: ${m['session']['total_pnl']:.4f} "
                      f"all-time: ${m['all_time']['total_pnl']:.4f} "
                      f"anomalies: {anom}")
            self._stop.wait(self.interval)

    def stop(self):
        self._stop.set()

# Global instance
_engine = None

def start(interval=60):
    global _engine
    record_new_session()
    _engine = MetricsEngine(interval)
    _engine.start()
    return _engine

def stop():
    global _engine
    if _engine:
        _engine.stop()

def record_new_session():
    """Call this on system startup to reset session metrics."""
    _record_session_start()
    # Write immediately so first notification has fresh data
    write_metrics()

# ── CLI test ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Running metrics engine test...")
    m = write_metrics()
    if m:
        print(json.dumps({
            "session":    m["session"],
            "calendar":   m["calendar"],
            "rolling_24": m["rolling_24hr"],
            "all_time":   m["all_time"],
            "heatmap_best": m["heatmap"]["best_hours"],
            "anomalies":  m["system"]["anomalies"],
            "drip":       m["drip"],
            "estimates":  m["estimates"],
        }, indent=2))
        print(f"\nmetrics.json written to: {METRICS_PATH}")
    else:
        print("ERROR: metrics calculation failed")
