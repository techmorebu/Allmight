# AllMight Project Ledger

Authoritative record of every cross-venue arbitrage surface investigated under
the AllMight constitutional framework. Updated after each Boss verdict.

**Last updated**: Wave 5 close
**Maintained by**: Boss (ChatGPT) ruling, CPT (Claude) implementation
**Capital state**: 0.042322364 ETH locked on Arbitrum; broadcast LOCKED throughout

---

## The 4-Class Taxonomy

Each surface, after measurement, lands in exactly one of four classes. Each
class implies a distinct remediation pathway (or non-pathway).

| Class | Definition | Remediation |
|---|---|---|
| `STRUCTURALLY_DEAD` | No executable counterpart depth. Discovery shows the cross-venue counterpart is too thin to support a trade size that would close any meaningful spread. | None — depth doesn't exist. Pivot away. |
| `BEHAVIORALLY_DEAD` | Depth present on both legs, but market behavior compresses spreads below actionable range. Active arbitrage bots keep the pair too tight to be arbed by an outside actor. | None — market is too efficient. Pivot away. |
| `ECONOMICALLY_BLOCKED` | Depth + lag signature + sustained spreads all present, but total fee/slippage/gas floor exceeds the spread distribution. Persistent inefficiency that cannot be captured under current cost structure. | Watch — fees could change; aggregator-routed events could occasionally cross floor. |
| `EXECUTION_READY` | All four viability variables align: depth, lag, spread distribution, fee floor. Floor-crossing events occur with executable frequency. | Operational; execute. Continue monitoring. |

---

## The Unified Execution Viability Model

```
Execution viability = depth + behavioral lead/lag signature
                          + spread distribution + fee floor

All four variables must align for EXECUTION_READY.
Each variable failing produces a distinct, diagnosable classification.
```

### Variable definitions

1. **Depth** — Active-tick liquidity (L × sqrtP, not TVL) on both legs, sufficient to support meaningful trade sizes without prohibitive slippage.

2. **Behavioral lead/lag signature** — The non-Uniswap (counterpart) venue must LAG UniswapV3 in price discovery. A counterpart that leads Uniswap means UniV3 is the slower side, which produces no arbitrable signal because UniV3 is the canonical reference price in the broader DEX ecosystem.

3. **Spread distribution** — The bp distance between leg prices must produce events that cross the execution floor with adequate frequency. Distributions can be: compressed (always tight), persistent but bounded, or frequent floor-crossing.

4. **Fee floor** — Total swap fees (both legs) + gas + slippage must be less than the typical magnitude of floor-crossing events in the spread distribution.

---

## Surface Ledger

### Arbitrum

#### ETH/USDC — UniswapV3 0.05% × Ramses V2 0.05%
- **Status**: `EXECUTION_READY`
- **First confirmed**: Wave 0 (project genesis)
- **Depth**: ✓ Deep on both legs
- **Lag signature**: ✓ Ramses lags UniswapV3
- **Spread distribution**: ✓ Frequent floor-crossing events observed
- **Fee floor**: ✓ ~10 bps total; spreads regularly exceed
- **Capital**: Allocated; execution armed
- **Notes**: The reference surface against which all other candidates are compared. Single confirmed instance of all four variables aligning.

#### ETH/USDT — UniV3 × Camelot V3 and UniV3 × SushiSwap V3
- **Status**: `STRUCTURALLY_DEAD`
- **Wave**: 2
- **Failure mode**: Counterpart depth insufficient. Sushi and Camelot ETH/USDT pools too thin to support meaningful trade sizes.
- **Rejection archived**: `docs/archive/rejected_surfaces/`

#### WBTC/USDC — UniV3 × SushiSwap V3
- **Status**: `STRUCTURALLY_DEAD`
- **Wave**: 3
- **Failure mode**: Sushi WBTC/USDC depth insufficient.
- **Rejection archived**: `docs/archive/rejected_surfaces/`

#### DAI/USDC — UniV3 × Camelot V3
- **Status**: `STRUCTURALLY_DEAD`
- **Wave**: 1 (Phase 2A.2)
- **Failure mode**: Stable-stable pair with structurally sticky pricing; counterpart depth issues prevented opportunity formation.
- **Rejection archived**: `docs/archive/rejected_surfaces/`

### Base

#### ETH/USDC — UniswapV3 0.05% × Aerodrome Slipstream tickSpacing=100
- **Status**: `BEHAVIORALLY_DEAD`
- **Wave**: 4
- **Pool A**: `0xd0b53D9277642d899DF5C87A3966A349A798F224` (UniV3, discovery depth $127M)
- **Pool B**: `0xb2cc224c1c9feE385f8ad6a55b4d94E92359DC59` (Slipstream, discovery depth $509M, real fee 6.34 bps)
- **Depth**: ✓ Deep on both legs (4× ratio in favor of counterpart)
- **Lag signature**: ✗ Slipstream LEADS UniV3 (`-79.8%` inversion bias in 480-obs sample). Counterpart-leads pattern.
- **Spread distribution**: ✗ Max 4.89 bps across 540 same-block observations (60 + 480). StdDev DECREASED with more data (1.45 → 1.33), indicating equilibrium not tail formation.
- **Fee floor**: ✓ Would be acceptable (~13.34 bps) if spread distribution permitted, but spreads never reach it.
- **Evidence**: 540 same-block observations across two probes
- **Failure mechanism**: Active arbitrage bots compress all spreads below the fee floor before they can grow. Hyper-efficient market.

#### ETH/USDC — UniswapV3 0.05% × Aerodrome V2 volatile
- **Status**: `ECONOMICALLY_BLOCKED`
- **Wave**: 5
- **Pool A**: `0xd0b53D9277642d899DF5C87A3966A349A798F224` (UniV3, 5 bp fee)
- **Pool B**: `0xcDAC0d6c6C59727a65F871236188350531885C43` (Aero V2 volatile, 30 bp fee confirmed via `getFee()`)
- **Depth**: ✓ $127M × $7.4M
- **Lag signature**: ✓ Aero V2 lags UniV3 in BOTH price directions (`+32.7%` inversion bias in 479-obs sample). Bidirectional lag confirmed.
- **Spread distribution**: Partial — sustained 10-30 bp band for up to 47.5 minutes continuously. Max 31.28 bps in 589 obs.
- **Fee floor**: ✗ 5 + 30 + gas/slippage = ~37 bps. Spread distribution ceiling lies BELOW this floor (max 31.28 bps).
- **Evidence**: 589 same-block observations (110 + 479)
- **Failure mechanism**: 30 bps Aero V2 fee deters bot activity entirely. Spread distribution naturally drifts in 10-30 bp range without active compression, but never reaches the 37 bps fee floor.
- **Notable**: 47.5-minute sustained event ≥ 10 bps (longest in project). Mirror-image failure mode versus Slipstream (efficient vs inert markets, both producing zero floor-crossings).

---

### Optimism

#### ETH/USDC — UniswapV3 0.05% × Velodrome Slipstream tickSpacing=100

- **Status**: `BEHAVIORALLY_DEAD`
- **Confidence**: HIGH
- **Verdict date**: 2026-06-02 (Boss C9 ruling)
- **Evidence**: 4-hour probe, 476 same-block observations, 100% data quality
  - Spread distribution: mean 1.08 bp, p99 3.00 bp, max **4.00 bp**
  - Fee floor: 6 bp (5 bp UniV3 + 1 bp Slipstream)
  - Threshold crossings ≥ 6 bp: **0 of 476** observations
  - Standard deviation: 0.65 bp (tight, bounded distribution)
  - Max sustained event ≥ 4 bp: 1 observation (~30 sec); ≥ 5 bp: zero
- **Market context**: ETH moved $42 (~2%) during the probe — not a stagnant
  market. The boundedness held despite substantial price action,
  ruling out the "quiet market" explanation.
- **Lead/lag finding**: Velodrome Slipstream is the price-discovery
  dominant venue (74.7% Velodrome-leads bias on single-venue tick changes).
  UniV3 is the tracking venue — the OPPOSITE of the Arbitrum and Base
  patterns. This finding triggered the framework refinement (see thesis
  Framework Refinement section).
- **Depth profile**: UniV3 0.05% active-tick depth ~$1,474 mean (stable);
  Velodrome Slipstream active-tick depth $19k-$351k (mean $76k, 18.6× LP
  churn range). Different mechanism than Aerodrome Slipstream on Base
  (which defended via stable $500M-class depth), yet identical
  BEHAVIORALLY_DEAD outcome — cross-mechanism convergence.
- **Pool addresses**:
  - UniV3 0.05%: `0x1fb3cf6e48F1E7B10213E7b6d87D4c073C7Fdb7b`
  - Velodrome Slipstream ts=100: `0x478946BcD4a5a22b316470F5486fAfb928C0bA25`
- **Archive**: [docs/archive/rejected_surfaces/optimism_eth_usdc_velodrome_slipstream/](./archive/rejected_surfaces/optimism_eth_usdc_velodrome_slipstream/)

---

## Wave-by-Wave Investigation History

| Wave | Investigation Focus | Outcome | Closes |
|------|---|---|---|
| 1 | Project foundations; Arbitrum DAI/USDC | DAI/USDC `STRUCTURALLY_DEAD`; phase2A pipeline built | Phase 2A.2 |
| 2 | Arbitrum ETH/USDT (Camelot + Sushi) | Both `STRUCTURALLY_DEAD`; probe constitutional formalized | ETH/USDT pair |
| 3 | Arbitrum WBTC/USDC (Sushi) | `STRUCTURALLY_DEAD`; chain-level finding escalated | WBTC/USDC pair |
| 4 | Cross-chain framework + Base ETH/USDC Slipstream | Slipstream `BEHAVIORALLY_DEAD`; cross-chain framework operational | Base CL search |
| 5 | Base ETH/USDC Aero V2 volatile | `ECONOMICALLY_BLOCKED`; 4-class taxonomy locked; bidirectional lag finding | Base coverage |
| 6 | Multi-chain Ramses-class search | AUTHORIZED — Optimism, Unichain, Sonic, Mantle | TBD |

---

## Confidence Standards

Every classification in this ledger meets these methodological standards:

- **100% same-block valid observations** — Cross-block spread measurements are invalid (5-14× inflation observed in early development); all data uses same-block anchoring.
- **Minimum 60 observations** for preliminary verdict
- **Extended 4-hour run (~480 obs)** required for HIGH-confidence locked verdict
- **Distribution stability check** — StdDev behavior across sample sizes (decreasing = stable; increasing = tail caution)
- **Lead/lag direction confirmed** across multiple market regimes when possible (e.g., bidirectional lag finding for Aero V2)
- **Active-tick depth only** — L × sqrtP within ±tickSpacing; never TVL (which is misleading)

---

## Capital and Operational State

- **Capital wallet**: `0xd2eaa2B2E0c475e418B1682d321eD77558D1b5Fb` (Arbitrum executor)
- **Capital amount**: 0.042322364 ETH
- **Capital status**: Untouched across all 6 waves
- **Execution**: Locked
- **Broadcast**: Locked
- **Armed surfaces**: Arbitrum ETH/USDC Ramses only (proven winner)
- **Smart contract**: ArbitrageBot at `0xD70d9f2245a23E3a4d07B2662029AD36f8dDa5a9` on Arbitrum

The constitutional framework holds: every operational decision passes through a Boss ruling. Discovery, probes, and classifications are research; only the proven winner has any operational arming, and that arming predates the formalized framework.

---

## Cross-References

- **Behavioral signature thesis**: [docs/thesis/behavioral_signature.md](./thesis/behavioral_signature.md)
- **DEX integration pitfalls**: [docs/lessons/dex_contract_discovery_pitfalls.md](./lessons/dex_contract_discovery_pitfalls.md)
- **Probe tool**: `scripts/research/surface_depth_probe.js`
- **Discovery tool**: `scripts/tools/multi_pair_pool_discovery.js`
- **Archive**: `docs/archive/rejected_surfaces/`
