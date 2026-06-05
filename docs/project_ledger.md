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

---

### Unichain

**Status:** investigated (W7, 2026-06-02). One surface classified, formally rejected.

**ETH/USDC × UniV3 0.30% × Velodrome V2 — `STRUCTURALLY_DEAD`** (W7)

- UniV3 factory on Unichain: `0x1f98400000000000000000000000000000000003` (NOT canonical — Unichain-specific per Uniswap docs)
- Velodrome V2 factory: `0x31832f2a97Fd20664D76Cc421207669b55CE4BC0`
- Velodrome V2 ETH/USDC pool: `0x13a6BC52C243a809394F3F656606213AEBd3e84D`
- Discovery results (2026-06-02): Velodrome V2 active-tick depth $88, UniV3 0.30% tier $2.9M (deepest)
- Critical number: Velodrome V2 depth $88 vs Ramses ~$7M → 79,500× smaller
- Combined economic floor: ~60+ bps (UniV3 5 + Velo V2 30 + gas)
- Probe not run (depth alone decisive per Boss C9 ruling 2026-06-02)
- Novel observation: UniV3 fee-tier depth INVERTED on Unichain (0.30% > 0.05% by 20×)
- Archive: [docs/archive/rejected_surfaces/unichain_eth_usdc_velodrome_v2/](archive/rejected_surfaces/unichain_eth_usdc_velodrome_v2/)

**Framework contribution:** First direct counterexample for "V2 architecture sufficient" — V2 present but depth absent → dead. Strengthens Pattern 2 substantially.

---

## Research Mission

**Mission (canonical, Boss-reaffirmed 2026-06-02 after Wave 7):**

> Map the viability landscape until the model becomes predictive.

This is a deliberate REFRAMING from the project's earlier objective ("find another EXECUTION_READY surface"). The framework is now mature enough that NEGATIVE results contribute as much information as positive ones — every surface, viable or not, refines the variable-necessity model.

### First predictive success: Wave 6 (Optimism CL)

Wave 4 surfaced behavioral signatures on Base CL (Aerodrome Slipstream → `BEHAVIORALLY_DEAD`). Pattern 1 was hypothesized: Solidly-fork CL → `BEHAVIORALLY_DEAD` across chains.

Wave 6 was the first test of that prediction: Optimism ETH/USDC × Velodrome Slipstream. The framework predicted `BEHAVIORALLY_DEAD` before any probe ran. Probe confirmed: max spread 4 bp vs 6 bp floor across 476 same-block observations.

**The framework transitioned from exploration to prediction.** That is the most important milestone the project has produced so far. Individual surfaces come and go; the predictive machine persists.

### Variable necessity model (canonical post-Wave 7)

Execution viability requires ALL of:
- **Depth (active-tick)** ≥ Ramses-class threshold
- **Behavioral signature** (loose tracking, structural lag)
- **Spread distribution** reaching above economic floor
- **Fee structure** compatible with achievable spreads

Each variable has a documented direct counterexample where its absence killed the surface:

| Variable | Counterexample | Wave |
|----------|----------------|------|
| Depth | Unichain Velo V2 (\$88 active-tick) | W7 |
| Behavioral lag | Base + Optimism Slipstream (tight tracking) | W4, W6 |
| Spread reaches floor | Base Aero V2 (max 31 bp < 37 bp floor) | W5 |
| Fee structure | (same as above — fees define the floor) | W5 |

See the [research notebook](research/ramses_class_surface_characteristics.md) for the canonical surface catalogue (n=9).

### Target

n = 15-20 classified surfaces before strong claims about model completeness. Current: n = 9.

---


### Sonic

**Status:** investigated (W8, 2026-06-04). One surface classified, formally rejected. **First chain investigated based on protocol lineage rather than chain popularity.**

**wS/USDC × Shadow V3 ts=50 × Shadow V2 volatile — `STRUCTURALLY_DEAD`** (W8)

- Chain ID 146 (standalone L1, NOT OP-Stack; Fantom successor — rebranded by Sonic Labs Dec 2024)
- Native gas: S; wrapped native: wS @ `0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38`
- USDC (Circle native, via CCTP) @ `0x29219dd400f2Bf60E5a23d13Be72B486D4038894`
- Shadow V3 factory: `0xcD2d0637c94fe77C2896BbCBB174cefFb08DE6d7` (Ramses V3 fork)
- Shadow V2 factory: `0x2dA25E7446A70D7be65fd4c053948BEcAA6374c8` (Solidly V2 fork)
- Discovery results (2026-06-04, block 72,434,879):
  - Shadow V3 ts=50: $1.22M active-tick depth (actual pool fee 28 bps via direct pool.fee() call)
  - Shadow V3 ts=1, 5, 10, 100, 200: ALL EMPTY (factory pools created but no LPs)
  - Shadow V2 volatile: $79 TVL (active-tick depth ~$79 since V2 has no concentration)
  - Shadow V2 stable: ~$0 (abandoned)
  - wS/USDC.e: no pools at any tier
- Critical number: Shadow V2 depth $79 vs Ramses $7M → 88,608× smaller (smaller than Unichain Velo V2)
- Combined economic floor: ~58+ bps (Shadow V3 28 + Shadow V2 30)
- Probe not run (depth gate failure prevents behavioral test, per Boss C9 ruling 2026-06-04)
- Archive: [docs/archive/rejected_surfaces/sonic_shadow_v3_shadow_v2/](archive/rejected_surfaces/sonic_shadow_v3_shadow_v2/)

**Framework contributions:**

1. **Protocol lineage helpful but NOT sufficient** — Shadow V3 confirms Ramses-family CL exists on Sonic (per `IRamsesV3Pool` import in Shadow source); Shadow V2's $79 fails the depth gate.

2. **Pattern 4 formalized** — Boss promoted the Ramses-family hypothesis from "loose tracking" to "candidate class" with four requirements (lineage + depth + behavior + fees). Status: UNRESOLVED on Sonic (passes 1/4).

3. **Pattern 5 tentative (n=2)** — modern chains (Unichain 2024, Sonic 2024-rebrand) both show V2 forks deployed but unused. Hypothesis: post-CL-dominant chains skip V2 liquidity.

4. **New venue type `ramses_v3` introduced** in our infrastructure (wave8 commit 3) — first venue type added specifically to track protocol lineage rather than ABI family alone.

5. **Two infrastructure gaps surfaced** during discovery, approved for follow-up commit:
   - aerodrome_v2 dispatch needs getPair fallback for Solidly-legacy V2 factories
   - ramses_v3 dispatch should read pool.fee() instead of using venue feeTiers as fee display


### Mantle

**Status:** investigated (W9, 2026-06-04). One surface class (two-pair, multi-venue) classified, formally rejected. **First chain investigated using an EXPLICITLY AUTHORIZED Ramses fork (BUSL-1.1 license from Ramses).**

**WETH/USDC + WMNT/USDC × Cleopatra CL × Cleopatra Legacy — `STRUCTURALLY_DEAD`** (W9)

- Chain ID 5000 (OP-Stack-derived L2, launched July 2023)
- Native gas: MNT; wrapped native: WMNT @ `0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8`
- USDC (Circle native, smallest address — token0 for all USDC pairs) @ `0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9`
- WETH (Mantle canonical vanity dead-prefix) @ `0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111`
- Cleopatra CL factory: `0xAAA32926fcE6bE95ea2c51cB4Fcb60836D320C42` (AAA-prefix vanity matches Arbitrum Ramses convention; BUSL-1.1 licensed)
- Cleopatra Legacy factory: `0xAAA16c016BF556fcD620328f0759252E29b1AB57` (Solidly V2 fork)
- ABI surprise: Cleopatra CL uses STANDARD UniV3 ABI (uint24 fee), NOT Ramses V3 (int24 tickSpacing) — empirical correction shipped as commit 1cf936e
- Discovery results (2026-06-04, block 96,242,502):
  - Cleopatra CL WETH/USDC fee=3000 (AAA-vanity pool): $23 active-tick depth
  - Cleopatra CL WETH/USDC fee=500: $0
  - Cleopatra CL WMNT/USDC fee=100: $0 (active pool, observation cardinality 1)
  - Cleopatra CL WMNT/USDC fee=10000: L=0 (MIN_TICK zombie, filtered)
  - Cleopatra Legacy WETH/USDC volatile: $0 (one reserve drained)
  - Cleopatra Legacy WMNT/USDC volatile: **$804** (highest on entire Mantle surface)
  - Cleopatra Legacy WMNT/USDC stable: $0 (misconfigured curve)
- Critical number: highest depth $804 vs Ramses $7M → ~8,700× smaller (~10× larger than Sonic Shadow V2 $79 but still far below executable threshold)
- Probe not run (depth gate failure prevents behavioral test, per Boss C9 ruling 2026-06-04)
- Archive: [docs/archive/rejected_surfaces/mantle_cleopatra_cl_legacy/](archive/rejected_surfaces/mantle_cleopatra_cl_legacy/)

**Framework contributions:**

1. **Lineage doesn't predict ABI** — Step 2 rejected the `ramses_v3` prior; Cleopatra CL uses standard UniV3 ABI despite being an authorized Ramses fork. Three Ramses-family deployments now have three different factory ABIs.

2. **Lineage doesn't predict depth** — Authorized fork with sophisticated AAA-prefix CREATE2 deployment still has dust depth across all pools.

3. **Pattern 4 DOWNGRADED as primary search strategy** — Three external Ramses-family deployments now untested due to depth gate failure. Boss ruling: Ramses lineage remains a useful prior but is no longer the primary search strategy. Wave 10 broadens.

4. **Pattern 5 strengthens to n=3** — Refined from "modern chains skip V2" to "Ramses-family V2 outside Arbitrum doesn't accumulate Ramses-class depth." Mantle (older 2023 chain) confirms the pattern crosses chain generations. HIGH confidence.

5. **New lesson logged** — `docs/lessons/dex_contract_discovery_pitfalls.md` updated with "Protocol lineage is a search prior, ABI is an empirical fact." Rule: every integration must empirically verify factory ABI, pool ABI, fee semantics, pool lookup behavior — never assume from lineage.


## Scoreboard

Canonical surface count and breakdown by classification. This block has
a deliberate code-fenced format that future deploys MUST target as a
single unit via str_replace, never via global regex. See commit
docs(ledger-repair) for the regex-corruption incident that motivates
this explicit-block convention.

```
EXECUTION_READY        1   Arbitrum ETH/USDC × Ramses
BEHAVIORALLY_DEAD      2   Base Slipstream + Optimism Velodrome Slipstream
ECONOMICALLY_BLOCKED   1   Base ETH/USDC × Aero V2
STRUCTURALLY_DEAD      7   4× Arbitrum + Unichain + Sonic + Mantle
                     ─────
n = 11 surfaces classified
```

**Target:** n = 15-20 classified surfaces before strong claims about the
predictive model.

**Last updated:** 2026-06-04 (post-Wave 9 closure)

---

## Wave-by-Wave Investigation History

| Wave | Investigation Focus | Outcome | Closes |
|------|---|---|---|
| 1 | Project foundations; Arbitrum DAI/USDC | DAI/USDC `STRUCTURALLY_DEAD`; phase5A pipeline built | Phase 2A.2 |
| 2 | Arbitrum ETH/USDT (Camelot + Sushi) | Both `STRUCTURALLY_DEAD`; probe constitutional formalized | ETH/USDT pair |
| 3 | Arbitrum WBTC/USDC (Sushi) | `STRUCTURALLY_DEAD`; chain-level finding escalated | WBTC/USDC pair |
| 4 | Cross-chain framework + Base ETH/USDC Slipstream | Slipstream `BEHAVIORALLY_DEAD`; cross-chain framework operational | Base CL search |
| 5 | Base ETH/USDC Aero V2 volatile | `ECONOMICALLY_BLOCKED`; 1-class taxonomy locked; bidirectional lag finding | Base coverage |
| 6 | Optimism ETH/USDC × Velodrome Slipstream | `BEHAVIORALLY_DEAD`; **framework first predictive success** (Base CL pattern predicted Optimism CL → confirmed by probe) | Optimism CL surface |
| 7 | Unichain ETH/USDC × UniV3 × Velodrome V2 | `STRUCTURALLY_DEAD`; first **V2-present + depth-absent** counterexample; novel UniV3 fee-tier inversion logged | Unichain investigation |
| 8 | Sonic wS/USDC × Shadow V3 × Shadow V2 | `STRUCTURALLY_DEAD`; Pattern 4 hypothesis test attempted, depth gate failure on V2 side ($79 vs Ramses $7M); Ramses-family CL lineage confirmed but counterpart liquidity absent; ramses_v3 venue type introduced | Sonic investigation |
| 9 | Mantle WETH/USDC + WMNT/USDC × Cleopatra CL × Cleopatra Legacy | `STRUCTURALLY_DEAD`; second Pattern 4 hypothesis test on authorized Ramses fork (BUSL-1.1); depth gate failure (max $804 vs Ramses $7M); ABI surprise refined the framework (lineage doesn't predict ABI OR depth); Pattern 5 strengthens to n=3; Pattern 4 downgraded as primary search strategy | Mantle investigation |

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

