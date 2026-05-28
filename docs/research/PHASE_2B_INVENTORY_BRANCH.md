# Phase 2B — Inventory Arbitrage Research Branch (CHARTER)

**Status:** ACTIVE research branch. **Research only — no execution, no wallet, no
inventory funding, no self-banking deployment.** (Boss Inventory Mode v1.)

## Why this branch exists
The flash-loan scorer (surface_score.js, G2.16/G2.17) proved stable flash-loan
arbitrage non-viable: the Aave 5bp flash fee dominates the ~2bp observed stable
dislocation. Boss verdict: *stable arbitrage may not be a flash-loan game — it may
be a balance-sheet game.*

## The constitutional separation
Flash-loan and inventory arbitrage are **different businesses** and are kept as
**separate economic models** (separate scripts). They MUST NOT be blended or
compared as one metric family.

```
                  FLASH-LOAN MODEL              INVENTORY MODEL
  script          surface_score.js              surface_score_inventory.js
  funding         Aave flash loan (atomic)      own balance sheet
  per-trade cost  venue + AAVE 5bp + gas + slip  venue + gas + slip (NO aave)
  gate            per-trade fee floor           capital-cost + FREQUENCY
  optimizes       atomicity, large spread        balance-sheet efficiency,
                  capture, zero idle capital     frequency, capital rotation,
                                                 micro-edge harvesting
  risk            revert only                    depeg / inventory / rebalancing
  success metric  surfaceScore (0-100)          per-trade margin + net (freq-gated)
```

`surface_score_inventory.js` output carries `MODEL = INVENTORY` and
`NOT COMPARABLE TO FLASH SCORE` on every record — by design.

## v1 scope and status (Boss rulings)
- Candidate: **arbitrum DAI/USDC**. Background/informational: ethereum DAI/USDC.
- Opportunity cost: 4% / $10k (`assumed_4pct_v1`) — annualized, `NEEDS_FREQUENCY`.
- Depeg risk: flag-only (`inventoryRisk` LOW|MEDIUM|HIGH), no penalty math.
- NET margin is intentionally NOT finalized in v1 (frequency telemetry absent).

## v1 result
```
arbitrum:DAI/USDC  per-trade breakeven 2.7bp / margin -0.7  → +0.7bp from viability
ethereum:DAI/USDC  per-trade breakeven 5.9bp / margin -3.9  (gas-disadvantaged)
```

## Open work (research only)
```
- Phase 2A.2 frequency telemetry — required to finalize net inventory margin
  (how often does the real dislocation exceed the 2.7bp per-trade floor?)
- opportunity-cost modeling refinement (yield source, capital base sensitivity)
- depeg-risk evolution (flag → quantified penalty) — future
- DECISION (step 6): is the inventory frontier worth telemetry expansion?
```

## Hard guardrails
No execution. No arming. No promotion. No wallet operations. No inventory capital
deployment. This branch produces analysis, not trades. Execution is "much later"
and a separate Boss decision (Phase 3), not implied by this research.
