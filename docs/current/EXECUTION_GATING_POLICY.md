# AllMight — Execution Gating Policy

**Version:** 1.0  
**Date:** 2026-04-28  
**Status:** ACTIVE — analytics mode only. Live execution blocked pending Boss approval.

---

## 1. Executive Summary

This policy defines the scoring formula, hard blockers, and capital mode gates that determine whether a signal is eligible for execution. All thresholds are calibrated to real session data from the AllMight signal engine (39 sessions, 6 Boss-valid).

**Current approved mode: MODE 0 — PAPER ONLY**

---

## 2. Calibration Data (as of 2026-04-28)

Derived from session_20260426_2209 and preceding valid sessions:

| Metric | Value | Source |
|---|---|---|
| Boss-valid sessions | 5/39 | confidence log |
| Sandbox viable rate (valid sessions) | 33.9–46.5%, avg 40.6% | sandbox_results.json |
| Confirmed candidates/session (valid) | 33–47 | activator.jsonl |
| Spread range (CONFIRMED_STRICT) | 0.207–0.220% (mean 0.214%) | tier_breakdown.json |
| Heat distribution | 79% EXTREME, 21% HOT | near_miss_analysis.json |
| Avg net at $200 (CONFIRMED_STRICT) | $0.19/signal | size_ladder.json |
| Flash loan readiness | NOT READY | flash_loan_readiness.json |
| Near-miss primary driver | SIM_MARGINAL (54%) | near_miss_analysis.json |
| Top UTC windows | 11:00, 22:00, 03:00 UTC | prior session analysis |

---

## 3. ExecutionScore Formula

```
ExecutionScore =
    0.30 × SpreadScore
  + 0.20 × HeatScore
  + 0.20 × TimingScore
  + 0.15 × InfraScore
  + 0.10 × SimulationScore
  + 0.05 × ConfidenceScore
```

Range: 0–100. Score ≥ 92 required for MICRO_LIVE_ELIGIBLE (still needs manual Boss approval).

---

## 4. Component Scoring

### 4.1 SpreadScore (weight: 0.30)

Primary economic gate. Calibrated to the CONFIRMED_STRICT spread range (0.207–0.220%).

```
spreadBps = netSpreadPct × 100

spreadBps < 22.0    → 0    (below CONFIRMED_STRICT floor — not viable)
22.0 ≤ bps < 23.0   → 40   (entry zone — low confidence)
23.0 ≤ bps < 24.0   → 65   (solid — overlaps session mean 21.4bps × 1.1)
24.0 ≤ bps < 26.0   → 85   (strong — above session mean)
≥ 26.0              → 100  (top tier — best 10 sandbox signals avg 43bps)
```

> **Note:** Session data shows the edge band is 0.207–0.220% (21–22 bps). Signals above 24bps represent the strongest confirmed spread class.

### 4.2 HeatScore (weight: 0.20)

Calibrated to observed heat distribution (79% EXTREME in CONFIRMED_STRICT tier).

```
EXTREME → 100   (dominant in confirmed signals)
HOT     → 75    (present in 21% of confirmed; viable but weaker)
WARM    → 20    (rare in confirmed tier; likely pre-structural)
COLD    → 0     (not present in any confirmed signal)
```

### 4.3 TimingScore (weight: 0.20)

Based on prior analysis identifying structural UTC windows.

```
hour (UTC):
  10–12 (11:00 window) → 100
  21–23 (22:00 window) → 100
  02–04 (03:00 window) → 100
  08–10, 14–16         → 70   (secondary windows)
  all other hours      → 40
  historically weak    → 10   (13:00–15:00 UTC — configure if validated)
```

### 4.4 InfraScore (weight: 0.15)

```
policy == STANDARD
  AND watchdog == HEALTHY
  AND RPC primary OK
  AND last fetch < 3 min ago     → 100

Minor warning (DEGRADED watchdog
  OR RPC rebuild count ≥ 8)      → 60

policy != STANDARD
  OR RPC primary unhealthy        → 25

PAUSE active
  OR watchdog FAILED
  OR fetch stale > 10 min         → 0
```

### 4.5 SimulationScore (weight: 0.10)

Calibrated to observed sandbox rates (valid sessions avg 40.6%).

```
sbViableRate ≥ 70%   → 100   (strong — exceeds observed range)
50–69%               → 80    (above observed avg; high confidence)
35–49%               → 60    (within observed valid-session range)
20–34%               → 35    (below valid-session floor; marginal)
< 20%                → 0     (pre-fix tolerance or weak session)
```

> **Note:** All 0% sandbox rates in prior sessions were PRE-FIX tolerance bugs. Valid session floor is 33.9%.

### 4.6 ConfidenceScore (weight: 0.05)

```
Boss-valid sessions (C1–C8 pass):
  ≥ 8 valid   → 100  (not yet reached)
  6–7 valid   → 90
  5 valid     → 75   (current level)
  3–4 valid   → 50
  1–2 valid   → 25
  0 valid     → 0
```

---

## 5. Current Score (as of 2026-04-28)

Using session_20260426_2209 metrics:

| Component | Value | Score | Weighted |
|---|---|---|---|
| SpreadScore | ~0.214% avg = 21.4bps | 40 | 12.0 |
| HeatScore | 79% EXTREME | 100 | 20.0 |
| TimingScore | varies by hour | 70 (mid estimate) | 14.0 |
| InfraScore | STANDARD + watchdog runs | 100 | 15.0 |
| SimulationScore | 40.4% viable | 60 | 6.0 |
| ConfidenceScore | 5 valid sessions | 75 | 3.75 |
| **TOTAL** | | | **~70.75** |

**Result: BLOCK** — below 75 threshold. Primary gap: SpreadScore (spread sits at lower edge of confirmed band).

---

## 6. Execution Gate Thresholds

```
Score < 75   → BLOCK            (no execution of any kind)
75–84        → PAPER_ONLY       (signal logged, no wallet interaction)
85–91        → DRY_WALLET_ONLY  (tx built, signed, NOT broadcast)
92+          → MICRO_LIVE_ELIGIBLE (still requires explicit Boss approval)
```

---

## 7. Hard Blockers (override score)

Any of the following **immediately sets gate to BLOCK** regardless of score:

```
policy != STANDARD
watchdog not running or FAILED
activator last record > 10 min stale
RPC primary unhealthy (all providers in cooldown)
netSpreadPct < 0.22%
amountOutMin not set (= 0 in blueprint)
minProfit ≤ estimated gas + buffer
session validity not C1–C8 compliant
LIVE_DEPLOY_APPROVED != true (for any live execution path)
flash loan NOT_READY (blocks live path; paper path unaffected)
```

---

## 8. Capital Modes

**Currently approved: MODE 0**

| Mode | Max Trade | Max/Session | Requirement |
|---|---|---|---|
| 0 — PAPER | $0 | — | Default until live approval |
| 1 — MICRO | $25 | 3 | Fork test pass + preflight pass + score ≥ 92 + Boss approval |
| 2 — PROBE | $50–$100 | 5 | 5+ clean micro trades + slippage within model + no revert |
| 3 — CONTROLLED | $200 | — | 3 clean live sessions + net positive |
| 4 — STANDARD | $500 | — | 5+ clean sessions + capture ≥ 70% + drawdown < 5% |

### Position Sizing Formula (for future live engine)

```javascript
baseSize =
  confidence < 80  → $25
  confidence 80–89 → $50
  confidence 90–94 → $100
  confidence 95–97 → $200
  confidence 98+   → $500

size = min(
  baseSize,
  approvedModeMax,       // currently $0
  bankroll × 0.20,
  liquiditySafeSize,     // from size_ladder.json
  gasAdjustedViableSize  // from flash_loan_readiness.json
)
```

---

## 9. Path to Score ≥ 92

To reach MICRO_LIVE_ELIGIBLE from current ~70.75:

| Improvement | Score gain |
|---|---|
| Spread reaches 24bps consistently | +13.5 pts |
| 8+ Boss-valid sessions | +1.25 pts |
| All UTC-window signals only | +6 pts (vs avg) |
| Sandbox rate reaches 50% | +2 pts |
| **Total potential** | **+22.75 → ~93.5** |

The primary lever is **spread quality**, not session count. Spread ≥ 24bps consistently achieved would push the system to MICRO_LIVE_ELIGIBLE unilaterally. All other components are already near ceiling.

---

## 10. What Does NOT Change This Policy

- Activator code changes
- Threshold adjustments
- RPC tuning
- Watcher changes
- Any non-Boss-approved architectural change

Score thresholds and capital modes require explicit Boss ruling to modify.
