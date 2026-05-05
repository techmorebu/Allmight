# NEXT ACTIONS — ORDERED
**Project:** AllMight  
**Phase:** Phase 1 COMPLETE → Awaiting Phase 3 deploy ruling  
**Updated:** 2026-05-05

---

## ✅ COMPLETED

- [x] 24h clean run (35.48h, session 20260503_1948)
- [x] ≥3 C9 sessions marked (2329 + 1948 + 0755)
- [x] Dry-run 641/641 WOULD_EXECUTE (100%)
- [x] Supervisor exit codes 10/11 + exponential backoff
- [x] Sticky primary RPC (Tenderly slot-0)
- [x] 8-process stack stable
- [x] Market regime + volatility acceleration in heartbeat
- [x] surface_regime_report.js built and run
- [x] Phase 2 surface registry (config/reporting foundation)
- [x] surface_portfolio_report.js built

---

## PRIORITY 1 — IMMEDIATE (do now)

### Task 1.1 — Mark C9 on session 0755
```bash
node scripts/tools/dryrun_confidence_log.js \
  --mark-c9 logs/sessions/session_20260505_0755
```

### Task 1.2 — Run surface portfolio report
```bash
node scripts/tools/surface_portfolio_report.js --all
```

### Task 1.3 — Run regime report with all new sessions
```bash
node scripts/tools/surface_regime_report.js --all
```

---

## PRIORITY 2 — AWAITING BOSS DEPLOY RULING

### Deploy decision: Micro-live Phase 3

**If Boss approves:**
```bash
# 1. Set deploy flag
echo "LIVE_DEPLOY_APPROVED=true" >> .env

# 2. Preflight check on live Arbitrum
node scripts/execution/preflight_ramses_executor.js

# 3. First trade criteria:
#    spread >= 24bps
#    watchdog: HEALTHY
#    size: $25 max
#    Manual Boss confirmation before each trade
```

**If Boss defers:**
```
Continue running sessions
Watch for first PRIME window (spread ≥22bps in live session)
Report PRIME + SURGING event to Boss immediately
```

---

## PRIORITY 3 — HEAT: UNKNOWN GAP (minor, non-blocking)

**Cause:** Volatility process restart creates ~30s gap in heat.jsonl freshness.
Activator reads heat with a freshness window. During restart, reports UNKNOWN.

**Fix options:**
1. Add grace period to watchdog heat freshness check (5min grace, not fail)
2. Activator falls back to last-known heat class during gap
3. Accept as-is (informational only, doesn't affect execution)

**Boss ruling required:** Should heat:UNKNOWN affect regime classification?
Currently: UNKNOWN routes to BUILDING (safe default). Acceptable?

---

## PRIORITY 4 — PHASE 2 EXPANSION (locked until Boss unlocks)

```
When Boss issues Phase 2 expansion ruling:

Step 1: Shadow-only observation (3 sessions each)
  - ARB/USDC  → update arb_usdc_candidate.json enabled=true
  - ETH/USDT  → update eth_usdt_candidate.json enabled=true

Step 2: Per-surface reporting
  - surface_portfolio_report.js shows bySurface breakdown
  - surface_regime_report.js updated for multiple surfaces

Step 3: Per-surface promotion
  Each surface: WATCHLIST → SHADOW_ONLY → V2_VALIDATED → DRY_RUN_ELIGIBLE
  Boss ruling required at each promotion step

DO NOT ACTIVATE until Boss Phase 2 unlock ruling
```

---

## DO NOT DO (without Boss ruling)

```
❌ Set LIVE_DEPLOY_APPROVED=true (Boss deploy ruling required)
❌ Enable watchlist surfaces (arb_usdc, eth_usdt, dai_usdc)
❌ Change gate weights (spread 0.30 → 0.40 still pending)
❌ Modify AllMightRamsesExecutor.sol
❌ Lower 22bps execution floor
❌ Add WebSocket block subscription (deferred)
```
