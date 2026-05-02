# AllMight — Live Readiness Gate

**Status: PRE-DEPLOYMENT. All technical blockers cleared. Operational blockers remain.**

---

## Execution Proof (COMPLETE — 2026-05-01)

| Layer | Result | Date |
|---|---|---|
| Fork test (18/18) | ✅ PROVEN | 2026-04-28 |
| Preflight (16/16 live Arbitrum) | ✅ PROVEN | 2026-04-28 |
| Dry run top-5 callStatic | ✅ PROVEN | 2026-05-01 |
| Dry run full session (641/641) | ✅ PROVEN | 2026-05-01 |

**Dry run findings (session 20260428_2329, 641 v2 survivors):**
- Execution success rate: **100%** (641/641 WOULD_EXECUTE)
- Zero reverts (no INSUFFICIENT_PROFIT, no RAMSES_SLIPPAGE, no panic)
- Funding: ALL_FUNDED on every signal
- Fork reset failures: 0

---

## Calibrated Execution Economics

| Spread | Net-positive rate | Avg net | Verdict |
|---|---|---|---|
| ≥26bps | 100% | +$0.13 | Elite |
| 24–26bps | 95%+ | +$0.10 | Preferred |
| 22–24bps | 95% | +$0.063 | Executable |
| 21–22bps | 79% | +$0.022 | Thin but viable |
| 20–21bps | 80% | +$0.008 | Marginal |
| <20bps | 31% | negative | Do not trade |

**Minimum live spread: 22bps**
**Preferred live spread: 24bps+**
**Gas: avg 600k units × 0.05 gwei = ~$0.069/signal**

---

## Remaining Blockers (operational — not technical)

### 🔴 Blocker 1: Clean 24h session (0 restarts)
- Required: One full session with `restartCount = 0` and `watchdog HEALTHY`
- Current: Sessions have 2+ restarts from activator crashes
- Fix: Let system run; identify and resolve restart root cause

### 🔴 Blocker 2: Boss explicit deployment approval
- Required: Boss ruling: "Deploy AllMightRamsesExecutor to Arbitrum mainnet"
- Current: BLOCKED — Boss has not issued deploy approval
- Condition: Blocker 1 resolved + Boss review of final dry run results

---

## Deployment Checklist (when Boss approves)

```
[ ] 1. LIVE_DEPLOY_APPROVED=true in .env
[ ] 2. EXECUTOR_ADDRESS not set (will be set after deploy)
[ ] 3. Run: npx hardhat run scripts/execution/deploy_ramses_executor.js --network arbitrum
[ ] 4. Run: EXECUTOR_ADDRESS=0x... node scripts/execution/preflight_ramses_executor.js
[ ] 5. Set EXECUTOR_ADDRESS in .env
[ ] 6. First trade: spread ≥ 24bps, manual watchdog confirmation, $25 max
```

---

## First Micro-Live Criteria (MODE 1)

```
spread >= 24bps
GAS_PRICE_GWEI <= 0.05
dry-run: WOULD_EXECUTE
watchdog: HEALTHY
restartCount: 0
minProfit: > gas + fees + buffer
size: $25 max
Boss explicit approval for first transaction
```

---

## What Does NOT Change Before Deploy

- Gate weights (0.30/0.20/0.20/0.15/0.10/0.05) — unchanged
- Thresholds (75/85/92) — unvalidated, unchanged  
- USDC-only direction — enforced at contract level
- DIRECTION_RAMSES_FIRST — enforced at contract level
- Capital mode — MODE 0 until Boss approves MODE 1
