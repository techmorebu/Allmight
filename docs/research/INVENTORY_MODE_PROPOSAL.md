# INVENTORY_MODE_PROPOSAL — no-aave stable arbitrage economic model

**Status:** APPROVED — Boss "Inventory Mode v1" rulings (2026-05-28). Classified **Phase 2B Research Branch** (NOT a Phase 3 execution candidate). Research only — no capital, no wallet, no inventory funding.
**Origin:** Boss G2.17 verdict — stable flash-loan arbitrage proven non-viable; the 5 bp
Aave flash fee dominates the ~2 bp observed stable dislocation. Boss directive:
*"Stable arbitrage may not be a flash-loan game. It may be a balance-sheet game."*

**Hard rule (Boss):** the flash-loan scorer and the inventory-mode scorer are SEPARATE
economic models. They must NOT be blended. This proposal designs the second model
without touching the first.

---

## 1. The two models, side by side

```
FLASH-LOAN MODEL (current, G2.16/G2.17)
  Funding:   Aave flash loan (atomic, zero capital)
  Per-trade: venueFee + AAVE 5bp + gas + slip
  Risk:      none beyond revert (atomic)
  Gate:      per-trade fee floor vs dislocation

INVENTORY MODEL (this proposal)
  Funding:   own balance sheet — hold both legs (e.g. DAI + USDC)
  Per-trade: venueFee + gas + slip          (NO Aave fee)
  Overlay:   capital opportunity cost (annualized yield forgone on deployed
             inventory) amortized over trade FREQUENCY
  Risk:      depeg/inventory risk on held stables; rebalancing drift
  Gate:      per-trade margin must clear the per-trade floor AND aggregate
             daily profit must clear the daily opportunity cost
```

The models are structurally different: flash mode is **fee-floor gated** (per-trade),
inventory mode is **capital-cost + frequency gated** (portfolio-level). That is why
they cannot share one breakeven number.

---

## 2. Projected per-trade inventory breakeven (drop Aave 5bp)

```
arbitrum:DAI/USDC:uni_camelot   venue 1.5 + gas 0.2 + slip 1  = 2.7 bp
ethereum:DAI/USDC:curve_uni     venue 2.5 + gas 2.4 + slip 1  = 5.9 bp
```

Per-trade margin at the observed ~2 bp dislocation:

```
size      arbitrum (be / margin)     ethereum (be / margin)
$1k        4.5 / -2.5                 27.5 / -25.5
$10k       2.7 / -0.7                 5.9  / -3.9
$100k      2.52 / -0.52               3.74 / -1.74
```

**Headline:** inventory mode moves arbitrum DAI/USDC from -5.7 bp (dead under flash)
to ~-0.7 bp (NEAR breakeven). A modestly larger observed spread (~3 bp, which stables
do reach during routine flow) flips arbitrum POSITIVE on a per-trade basis. Ethereum
stays negative at observed spread — its gas defeats even the no-aave model until size
is large. So the inventory candidate is ARBITRUM only.

---

## 3. The real gate: capital opportunity cost (the honest catch)

Inventory is not free. $X held as DAI+USDC forgoes yield it could earn elsewhere
(e.g. ~3-5% APY supplying Aave/lending). That cost is ANNUALIZED and amortized over
trade frequency:

```
opportunityCostPerTradeBps  =  (annualYieldForgone / tradesPerYear) expressed in bps
```

- If frequency is HIGH and per-trade margin is positive, opportunity cost per trade is small.
- If frequency is LOW or per-trade margin ~0, opportunity cost dominates -> not worth it.

This couples inventory viability to the FREQUENCY quality dimension (currently unmeasured).
**Inventory mode cannot be scored honestly without dislocation-frequency telemetry.**
This is the strongest argument for Phase 2A.2 behavioral accumulation.

---

## 4. Proposed no-aave scorer design (kept SEPARATE per Boss)

Two separation options for Boss to choose:

```
OPTION A — separate script: scripts/tools/surface_score_inventory.js
  + hard physical separation (cannot accidentally blend)
  + own report file (surface_score_inventory.{json,txt})
  - some duplicated scaffolding

OPTION B — same script, explicit --model inventory flag
  reads a SEPARATE config block: inventoryBreakevenComponents
  (venueFeeBps + estimatedSlipBps + gasUsdPerTx; NO aaveFeeBps)
  output labeled MODEL: INVENTORY; never merged with flash output in one table
  + reuses validated scaffolding
  - relies on discipline to never blend in display

CPT recommendation: OPTION A (separate script). Boss's "do not blend" is safest
enforced physically. The inventory model also needs DIFFERENT inputs (opportunity
cost, frequency, depeg risk) that would bloat the flash scorer.
```

The inventory scorer would compute:
```
  inventoryPerTradeBreakevenBps  = venue + gas + slip          (deterministic)
  perTradeMarginBps              = dislocation - inventoryPerTradeBreakeven
  opportunityCostPerTradeBps     = f(capitalBase, annualYield, frequency)   [needs freq telemetry]
  netInventoryMarginBps          = perTradeMarginBps - opportunityCostPerTradeBps
  + depeg risk flag / penalty (configurable)
```

---

## 5. Boss decision points (sign-off requested)

```
1. Separation approach: Option A (separate script) or Option B (mode flag)?
   CPT recommends A.

2. Capital opportunity cost: what annual-yield-forgone assumption? (e.g. 4% APY
   Aave-supply baseline). And what reference capital base for amortization?

3. Depeg/inventory risk: include a penalty term now, or flag-only for v1?

4. Frequency dependency: accept that inventory mode is UNSCORABLE for net margin
   until Phase 2A.2 frequency telemetry exists? (v1 can report per-trade margin
   + flag opportunity cost as NEEDS_FREQUENCY.)

5. Scope of first re-score: arbitrum DAI/USDC only (ethereum stays negative even
   no-aave at observed spread), or both for completeness?
```

---

## 6. What this is NOT (guardrails)

```
- NOT a tweak to the flash-loan scorer (separate model, Boss rule)
- NOT a decision to deploy inventory capital (research only)
- NOT execution, arming, or promotion of any surface
- NOT a claim that stable arb is profitable — only that it MIGHT be viable on
  arbitrum under inventory economics at slightly-above-observed spreads, pending
  frequency + opportunity-cost modeling
```

**Strategic framing (Boss):** stable arbitrage is plausibly a balance-sheet game,
not a flash-loan game — now supported by measured per-trade economics, not intuition.
The next step is design sign-off, then a SEPARATE inventory scorer, then re-score.


---

## 7. BOSS RULINGS (FINAL — Inventory Mode v1)

```
1. Separation     OPTION A — separate script scripts/tools/surface_score_inventory.js
                  No --model flag. Constitutional separation (physical).
2. Opportunity    4% annual yield forgone, $10,000 base, opportunityCostSource="assumed_4pct_v1"
                  (research assumption, not market truth)
3. Depeg risk     flag-only: inventoryRisk = LOW|MEDIUM|HIGH. No penalty math v1.
4. Frequency      NET margin NOT scoreable until Phase 2A.2 telemetry. Output
                  perTradeMarginBps + opportunityCostStatus = NEEDS_FREQUENCY.
5. Scope          arbitrum DAI/USDC = CANDIDATE; ethereum = BACKGROUND/informational.
Classification    Phase 2B Research Branch (research first, execution much later).
Labels            MODEL = INVENTORY and NOT COMPARABLE TO FLASH SCORE, everywhere.
```

## 8. v1 measured result (built, validated)

```
arbitrum:DAI/USDC:uni_camelot   per-trade breakeven 2.7bp  margin -0.7  (flash was -5.7)
ethereum:DAI/USDC:curve_uni     per-trade breakeven 5.9bp  margin -3.9  (BACKGROUND)
opportunity cost $400/yr [NEEDS_FREQUENCY]; net margin not finalized.

Frontier signal: arbitrum is within +0.7bp of clearing the per-trade floor. Whether
real dislocations exceed 2.7bp often enough is a FREQUENCY question → motivates
Phase 2A.2 telemetry expansion. Stable arb is plausibly a balance-sheet game on
Arbitrum at slightly-above-observed spreads — to be confirmed by frequency data.
```
