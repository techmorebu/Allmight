# SYSTEM GUARDRAILS
**Project:** AllMight  
**Authority:** Boss  
**CPT must read this before touching any code.**

---

## CORE RULES (non-negotiable)

1. **Determinism over cleverness** — no prediction models, no heuristics, no "smart" guessing
2. **No TA / SMC / price prediction** — this system detects structural spreads, not price direction
3. **No live execution without Boss approval** — LIVE_DEPLOY_APPROVED must be set by Boss ruling, never by CPT
4. **No expansion before unlock** — single surface (ETH/USDC Ramses) only until Boss unlocks
5. **Boss ruling before code** — no classification, threshold, or architectural decision without explicit Boss approval

---

## DEVELOPMENT RULES

- **Patch-based only** — read exact file lines before patching, grep-validate after
- **No rewrites** — replace targeted sections, never rewrite entire files
- **Fail-soft everywhere** — missing files/data must never crash a running process
- **Backward compatibility** — never break existing log schemas or field names
- **Serial reads** — Promise.all only within a single contract call, never across contracts
- **Deterministic output** — controlled verdict sets, no ambiguous classifications

---

## EXECUTION RULES

- **Spread is the primary signal** — all gate components are directional, spread dominates
- **Minimum viable spread: 20bps** (17.4bps is theoretical, 20bps is practical)
- **Preferred spread: ≥22bps** — 95% net-positive at this level
- **Elite spread: ≥24bps** — deploy watchdog + dry-run
- **Ignore: <20bps** — not worth live risk at current gas levels

---

## WHAT CPT IS ALLOWED TO DO

```
✅ Fix bugs in existing scripts
✅ Add analytics/reporting tools (fail-soft, read-only)
✅ Improve logging and Discord output
✅ Patch supervisor/startup reliability
✅ Add env-gated features (default off until tested)
✅ Re-run shadow engines on historical sessions
✅ Mark C9 on qualifying sessions
✅ Run dry execution fork runner on sessions with ≥22bps signals
```

## WHAT CPT IS NOT ALLOWED TO DO

```
❌ Enable live execution
❌ Change gate weights without Boss ruling
❌ Add new trading surfaces
❌ Modify execution contract (AllMightRamsesExecutor.sol)
❌ Lower the 22bps execution floor
❌ Lower the $10k active-tick depth floor
❌ Change capital mode (stays MODE 0)
❌ Interpret ambiguous signals as "probably safe"
❌ Skip Boss ruling for "obvious" changes
```

---

## INFRA GUARDRAILS

```
RPC:
  Tier 1 (PRIMARY): Tenderly — must handle ≥90% of calls
  Tier 2 (BACKUP):  Infura   — cold failover only (<5%)
  Tier 3:           Alchemy/Ankr — last resort
  RPC_DESIGNATED_PRIMARY_URL must be set in .env

Supervisor:
  exit(0)  = RPC_EXHAUSTION     → cooldown
  exit(10) = PROLONGED_STALE    → cooldown (exponential: 5/10/15min)
  exit(11) = RPC_DEGRADED       → cooldown
  Any other exit = crash        → 5s restart
  CONSEC reset after 33min+ run (stale threshold × 3)

Processes (all 8 required):
  fetcher → activator → volatility → heat → monitor → watchdog → notif → shadow
```

---

## ANALYTICS RULES

- Analytics inform decisions — they do not trigger trades
- Reports go to Boss for ruling before any action
- Never use surface_regime_report.js output to auto-adjust gates
- Never use heartbeat regime to enable/disable signals
- Validate with data, not intuition

---

## PHASE LOCK

**Current phase: Execution Validation (Single Surface)**

```
LOCKED until ALL of these are true (Boss must rule):
  1. 24h clean session (0 uncontrolled restarts)
  2. ≥3 C9 sessions marked
  3. Dry-run ≥80% success rate on recent signals
  4. No unknown errors
  5. Boss explicit deploy approval

Locked systems (do not touch):
  - Multi-surface expansion
  - Ethereum mainnet execution
  - Capital deployment
  - Gate threshold changes
  - Contract modifications
```

---

## KNOWN ARCHITECTURAL DECISIONS (do not second-guess)

| Decision | Ruling | Do not change |
|----------|--------|---------------|
| Active-tick depth ≥$10k | Boss ruling | Hard floor |
| DIRECTION_RAMSES_FIRST | Contract enforced | Cannot change |
| USDC-only | Contract enforced | Cannot change |
| 5bps friction (v2) | Calibrated from 6,749 records | Do not adjust |
| Same-block anchoring | CPT finding, Boss confirmed | Mandatory |
| Spread = primary predictor | Gate backtest verdict | Do not override |
| No Promise.all across contracts | Architectural ruling | Serial reads only |
