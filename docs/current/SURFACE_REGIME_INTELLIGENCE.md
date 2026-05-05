# Surface Regime Intelligence
**Project:** AllMight  
**Layer:** Awareness only — does not trigger trades  
**Updated:** 2026-05-05

---

## What This Is

Market Regime is an **informational layer** that tells the operator whether the
ETH/USDC-Ramses surface is quiet, building, active, prime, or elite at any given
moment. It does not change gates, weights, or execution behavior.

**Market Regime = awareness. Execution remains locked.**

---

## Regime Definitions (Boss ruling 2026-05-05)

| Regime | Condition | Action |
|--------|-----------|--------|
| ⚡ ELITE | maxSpread ≥ 26bps OR any 26bps+ signal | Boss review window |
| ⚡ ELITE | maxSpread ≥ 24bps | candidate watch |
| 🔥 PRIME | maxSpread ≥ 22bps | dry-run eligible |
| 📈 ACTIVE | maxSpread 20–22bps OR v2 survival ≥ 25% | candidate watch |
| 🌡 BUILDING | maxSpread 18–20bps OR heat = HOT/EXTREME | monitor |
| 💤 QUIET | maxSpread < 18bps AND survival < 10% | observe only |

**Key:** Regime uses `maxSpread` (session maximum), not current or average spread.
A PRIME window means the surface has reached ≥22bps at some point this session —
not that it is currently at 22bps.

---

## Discord Heartbeat Format

```
─── Market Regime ─────────────────
Market:    💤 QUIET
Spread:    15.3bps  Best: 20.29bps
Heat:      COLD
Survivors: 0/145
Action:    observe only
```

- **Spread** = current tick spread (latest heartbeat)  
- **Best** = session maximum spread seen (used for regime)  
- **Survivors** = v2 realistic survivors (count/total)  
- **Action** = operator recommendation (not automatic)

---

## Surface Regime Report

Run after sessions to identify historical UTC windows:

```bash
node scripts/tools/surface_regime_report.js --all
```

Output: `logs/project_metrics/surface_regime_report.txt`

The report answers:
- Which UTC hours does the surface typically produce 22bps+ signals?
- Which hours are reliably quiet (safe for slow-poll / RPC conservation)?
- When should dry execution be run?
- Which windows deserve focused operator monitoring?

---

## What This Session (20260503_1948) Told Us

```
Duration:   35.48h
Max spread: 20.29bps
Regime:     ACTIVE (surface reached 20bps+ but not 22bps)
Signals:    0 above 22bps floor
Conclusion: This surface is low-frequency — not a constant income stream
```

**Boss ruling:** This confirms the surface is episodic. Multi-surface expansion
(Phase 2) is the correct long-term path but remains locked until Phase 1 unlock.

---

## What Regime Is NOT

- ❌ Not a trading signal — regime does not trigger or block execution
- ❌ Not a gate — spread floor of 22bps is unchanged
- ❌ Not a prediction — regime reflects observed history and current session max
- ❌ Not a reason to adjust weights — weights are locked pending Boss ruling

---

## Integration Points

| Component | What it does | Where |
|-----------|-------------|-------|
| `notification_router.js` | Shows regime in every 5-min heartbeat | Discord #ops |
| `surface_regime_report.js` | Ranks UTC windows by historical regime | `logs/project_metrics/` |
| `NEXT_ACTIONS.md` | Feeds into operator timing decisions | `docs/current/` |

---

## Operator Decision Guide

```
Discord shows 💤 QUIET  → no action, system running correctly
Discord shows 🌡 BUILDING → check back in 30min
Discord shows 📈 ACTIVE  → watch Discord, check status
Discord shows 🔥 PRIME   → consider running dry_execution_fork_runner.js
Discord shows ⚡ ELITE   → notify Boss immediately
```

The 24h clean session (20260503_1948) ran through a QUIET/ACTIVE cycle.
When the surface enters PRIME for the first time in a live session,
that is the signal to bring Boss into the loop.
