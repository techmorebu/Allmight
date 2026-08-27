# Behavioral Signature Thesis

The AllMight project's most refined understanding of when a cross-venue
arbitrage surface is executable. Formalized at the close of Wave 5.

---

## Genesis

Through Waves 1-5, the AllMight project investigated six candidate cross-venue
arbitrage surfaces. One produced executable opportunity (Arbitrum ETH/USDC
Ramses). Five did not. The distinction between success and failure was not
depth, fees, venue type, or chain alone — it was a combination of variables
that together form what we call the **behavioral signature**.

This document is the canonical statement of that finding.

---

## The Four-Variable Model

Execution viability for a cross-venue arbitrage surface depends on four
variables that must all align:

### 1. Depth

Both legs must have sufficient **active-tick liquidity** (L × sqrtP within
the active tickSpacing range) to support a meaningful trade size without
prohibitive slippage.

**Critical distinction**: Active-tick depth, NOT TVL. TVL is a misleading
metric because it counts liquidity in inactive tick ranges that contribute
nothing to current arb sizing. A pool with $1B TVL but $50k of active-tick
depth is structurally thin for arbitrage purposes.

### 2. Behavioral Lead/Lag Signature

The non-Uniswap (counterpart) venue must **LAG UniswapV3** in price discovery.

UniswapV3 is the de facto reference price across the broader DEX ecosystem.
Aggregators, market makers, and front-running bots all calibrate against it.
For a surface to be arbitrable from an outside actor's perspective, the
counterpart must be the slower-repricing side, producing an information lag
that the actor can capture.

A counterpart that LEADS UniswapV3 produces the opposite dynamic: UniV3
becomes the slow side, and the surface is uncompetitive against the broader
market's existing arb infrastructure.

### 3. Spread Distribution

The price spread between the two legs must produce events that **cross the
execution floor with adequate frequency**.

Spread distributions observed in the project's data fall into three patterns:
- **Compressed** (always tight, sub-5 bps): behaviorally dead
- **Persistent but bounded** (10-30 bps sustained, never crossing floor): economically blocked
- **Frequent floor-crossing** (variable, with regular events above fee floor): execution ready

### 4. Fee Floor

Total swap fees (both legs) + gas + slippage must be **less than** the
spread distribution's typical floor-crossing magnitude.

High counterpart fees can render an otherwise-viable surface economically
blocked. The Aero V2 case demonstrated this empirically: correct lag
signature, persistent 10-30 bp spreads, deep liquidity — but 30 bp counterpart
fee makes the 37 bp floor unreachable by the spread distribution.

---

## Empirical Evidence

All six surfaces investigated map cleanly to the 4-class taxonomy:

| Surface | Depth | Lag | Spread | Fees | Status |
|---|:---:|:---:|:---:|:---:|---|
| Arbitrum ETH/USDC × Ramses | ✓ | ✓ | ✓ | ✓ | `EXECUTION_READY` |
| Base ETH/USDC × Slipstream ts=100 | ✓ | ✗ | ✗ | ✓ | `BEHAVIORALLY_DEAD` |
| Base ETH/USDC × Aero V2 vol | ✓ | ✓ | partial | ✗ | `ECONOMICALLY_BLOCKED` |
| Arbitrum ETH/USDT | ✗ | — | — | — | `STRUCTURALLY_DEAD` |
| Arbitrum WBTC/USDC | ✗ | — | — | — | `STRUCTURALLY_DEAD` |
| Arbitrum DAI/USDC | ✗ | — | — | — | `STRUCTURALLY_DEAD` |

Every variable failure has produced at least one classified surface. The
taxonomy is complete and operational.

---

## The Bidirectional Lag Finding

Wave 5's most important structural discovery: **a venue's lag signature is
direction-independent**.

In the 479-observation Aero V2 extended probe, two market regimes were
captured within a single dataset: rising ETH and falling ETH. In both
regimes, Aero V2 lagged UniswapV3. The price RELATIONSHIP (which leg was
higher) flipped depending on direction, but the BEHAVIORAL ROLE
(who reacts first) remained fixed.

**Implications**:
- Lag is not a one-way phenomenon (counterpart slow to follow upward moves)
- Lag is an inherent property of how a venue absorbs information through
  its swap mechanism — driven by LP activity patterns, fee structure, and
  AMM topology
- The role of "leader" vs "follower" between two venues is fixed by
  structural factors, not by market direction or current state

This is a stronger formulation of the lead/lag variable than single-direction
observation could support. It also explains why the lead/lag signature is
predictive across market regimes: it captures something structural about
the venue itself, not a transient state.

---

## Mirror-Image Failure Modes

Slipstream ts=100 and Aero V2 volatile both fail to produce executable arb
on the same chain (Base), in the same pair (ETH/USDC), against the same UniV3
counterparty (the 0.05% pool). But they fail for **opposite reasons**.

| Property | Slipstream ts=100 | Aero V2 volatile |
|---|---|---|
| Inversion bias | −79.8% (counterpart leads) | +32.7% (UniV3 leads) |
| Median spread | 2.63 bps | 13.25 bps |
| Max spread (4hr) | 4.89 bps | 31.28 bps |
| StdDev (4hr) | 1.33 bps | 8.37 bps |
| Sustained events ≥10 bp | 0 | 10 events, longest 47.5 min |
| Fee floor | 13.34 bps | 37 bps |
| Floor crossings (4hr) | 0 | 0 |
| Failure mechanism | Bots compress spreads | Bots avoid the pool |
| Market structure | Hyper-efficient | Inert |

The behavioral signature variable distinguishes them. Both have deep
counterpart liquidity. Both produce zero floor-crossing events. But the
mechanisms producing this outcome are mirror images:

- **Slipstream**: hyper-efficient market where bots compress all spreads
  below the (low) fee floor before they can grow
- **Aero V2**: inert market where bots avoid the pool because the (high)
  fee floor exceeds what they can profitably capture, so spreads drift
  freely but never reach the floor

The classification taxonomy captures this distinction precisely:
`BEHAVIORALLY_DEAD` vs `ECONOMICALLY_BLOCKED`. Each implies a different
watch-state and a different remediation pathway.

---

## The Predictive Variable

Before Wave 4, project decisions were made on four dimensions:
- Depth
- Fees
- Chain
- Venue type

After Wave 5, **lead/lag direction is the fifth — and apparently most
predictive — variable**. A surface with:

- Deep counterpart **AND** counterpart-lags-UniV3 signature
  → IS a candidate for arb (Ramses class)

- Deep counterpart **AND** UniV3-lags-counterpart signature
  → IS NOT a candidate regardless of other variables (Slipstream class)

This is the single most useful filter the project has produced. It cuts
deeper than depth alone, because it captures whether the deeper pool is
structurally suited to be the slower side of the arb pair.

Most arbitrage hunters never measure this. Standard DEX discovery focuses on:
- TVL
- Volume
- APR
- Fee tier

These are the visible, surface-level metrics. They are insufficient. The
AllMight framework measures:
- Information propagation
- Lead/lag relationships
- Spread persistence
- Economic viability

These are harder measurements, requiring same-block reads and extended
observation windows. They are also far more predictive.

---

## Wave 6 Hypothesis

The Ramses-class surface (deep + lag + spreads + low fees) was found once
across six investigations. Wave 6 expands the experimental base to additional
chains:

- Optimism
- Unichain
- Sonic
- Mantle

The hypothesis under test: **Is Ramses a unique anomaly on Arbitrum, or one
member of a recurring market-structure class?**

Either result is informative:
- If additional Ramses-class surfaces exist on other chains: the project
  graduates from "single anomaly" to "repeatable market structure"
- If they do not: the project has identified a genuinely rare configuration,
  and the Arbitrum Ramses surface gains significance as a unique opportunity

The framework is positioned to classify each new surface cleanly regardless
of outcome.

---

## Wave 6 Result (2026-06-02)

The Wave 6 hypothesis is **confirmed**. Optimism ETH/USDC × Velodrome
Slipstream tickSpacing=100 classifies as `BEHAVIORALLY_DEAD` with HIGH
confidence after a 4-hour probe (476 same-block observations, 100% data
quality, Boss C9 ruling).

### Spread distribution

- Mean: 1.08 bp
- Standard deviation: 0.65 bp
- p99: 3.00 bp
- Maximum: 4.00 bp
- Threshold crossings ≥ 6 bp (fee floor): **0 of 476**

### Market context — quiet-market explanation explicitly ruled out

ETH moved $42 (~2%) during the 4-hour probe. Spread boundedness held
despite this substantial price action. A quiet market could explain low
spreads; a moving market that still produces no executable spreads is
strong evidence that the spread process is structurally bounded below
viability.

### The predictive moment

The Base Aerodrome Slipstream prior (Wave 4) generated a
`BEHAVIORALLY_DEAD` expectation for Optimism Velodrome Slipstream
BEFORE the probe ran. The probe confirmed. This is the first instance
in the project where the framework demonstrated **predictive** power
rather than merely **descriptive** power. It marks the project's
transition from exploration to theory.

### Cross-mechanism convergence

Aerodrome Slipstream (Base) achieves efficient tracking via **stable
$500M-class depth** — large pool, sticky LPs, size-based defense.

Velodrome Slipstream (Optimism) achieves efficient tracking via
**aggressive LP churn** — active-tick depth swinging from $19k to $351k
(18.6× range) during the 4-hour probe, indicating high LP turnover
within the active range.

Two distinct LP-defense mechanisms; identical behavioral outcome. Both
belong to the Solidly-fork CL family. This is a non-trivial finding:
the behavioral signature is more fundamental than any single defense
mechanism. What matters is the OUTCOME (efficient tracking), not the
mechanism (size vs. activity).

---

## Framework Refinement: Dominant Venue / Tracking Venue (2026-06-02)

The Optimism probe revealed that "UniV3 leads price discovery" is **not
a universal pattern**. On Optimism, Velodrome Slipstream led 74.7% of
single-venue tick-change events (vs. UniV3's 25.3%) — the opposite of
the Arbitrum pattern (UniV3 leads Ramses).

The thesis is hereby refined (per Boss C9 ruling, 2026-06-02). The
canonical framework chain is:

```
Price-discovery dominant venue
       ↓
Tracking venue
       ↓
Tracking quality (loose vs. tight)
       ↓
Execution viability (gated by fee floor)
```

### Implications of the refinement

1. **Dominant venue is per-chain, not universal.** It is determined by
   local liquidity structure — typically the deepest pool or the one
   with the most active LP repricing. UniV3 is dominant on Arbitrum
   and Base; Velodrome is dominant on Optimism.

2. **What matters for arbitrage viability is the TRACKING venue's
   behavior**, not the dominant venue's behavior. The tracking venue
   either tracks tightly (`BEHAVIORALLY_DEAD`) or loosely (potentially
   `EXECUTION_READY`, subject to fee economics).

3. **Ramses (Arbitrum) remains the only known LOOSE TRACKER** in the
   project's sample set (3 chains, 7 surfaces). Its uniqueness may be
   architectural (V2 constant-product, no concentrated liquidity to
   "defend"), structural (Arbitrum LP composition and MEV regime),
   or both. This is the active research frontier and the central
   question for Wave 7+.

4. **The behavioral signature is symmetric.** It does not depend on
   which side of the surface is the dominant venue. A loose tracker
   produces executable spreads regardless of whether it's the V3 or V2
   leg, the larger or smaller pool, the UniV3 or counterpart venue.

5. **Classification methodology unchanged**: still measure depth,
   compute spread distribution under same-block anchoring, check
   against fee floor. Only the vocabulary for describing WHICH side
   is which has changed.

### Vocabulary deprecation

| Deprecated | Canonical |
|------------|-----------|
| "UniV3 leads" | "Price-discovery dominant venue" |
| "Counterpart lags" | "Tracking venue" |
| "Lag signature" | "Tracking quality" (loose / tight) |
| "Spread crosses fee floor" | "Execution viability" (achieved / not) |

All future classifications should use the canonical vocabulary. Earlier
classifications in this document and in `docs/project_ledger.md` retain
the original wording for historical preservation; their conclusions are
unchanged.

---

## Methodology Standards

All measurements supporting this thesis adhere to these standards:

- **Same-block reads are mandatory.** Cross-block spread measurements are
  invalid (5-14× inflation observed in early development).
- **Active-tick depth is the only valid execution liquidity metric.**
  L × sqrtP within ±tickSpacing. TVL is never substituted.
- **Probe duration must span multiple market regimes.** ~4 hours minimum
  for high-confidence verdicts.
- **Standard deviation behavior is the primary diagnostic.** Decreasing
  with sample size = stable process. Increasing = potential tail formation.
- **Lead/lag bias is computed on single-venue asymmetric moves only.**
  When both venues move, no leadership signal can be extracted. When
  neither moves, also uninformative. Only obs where exactly one venue
  changed tick (or, for V2 pools, price > $0.01 threshold) contribute.
- **Fee floor calculation must include real (not assumed) pool fees.**
  `pool.fee()` is read on-chain for V3-style pools; `factory.getFee()`
  for V2-style. Default assumptions are documented but always verified
  before final classification.

---

## Cross-References

- **Project ledger** (all classified surfaces): [docs/project_ledger.md](../project_ledger.md)
- **DEX integration pitfalls** (technical lessons): [docs/lessons/dex_contract_discovery_pitfalls.md](../lessons/dex_contract_discovery_pitfalls.md)
- **Probe tool** (measurement instrument): `scripts/research/surface_depth_probe.js`
- **Discovery tool** (surface inventory): `scripts/tools/multi_pair_pool_discovery.js`

---

*This document is canonical. Future research findings that materially
refine the model should be appended (not replaced) and dated. The thesis
itself may be superseded by new evidence; preserving the original allows
the project's epistemic evolution to be traced.*

## Wave 7 Result (2026-06-02)

**Surface:** Unichain ETH/USDC × UniV3 × Velodrome V2
**Verdict:** `STRUCTURALLY_DEAD` (HIGH confidence, Boss C9 ruling 2026-06-02)
**Probe:** not run (depth alone decisive)

### Findings

Discovery measured Velodrome V2 active-tick depth at **$88** — five-plus
orders of magnitude below Ramses (~$7M). With Velodrome V2's 30 bps
fee adding to UniV3's 5 bps to produce a ~60+ bps economic floor, no
behavioral lag pattern could compensate. Probe correctly skipped.

### Framework contribution: Pattern 2 strengthened

This surface is the first direct counterexample for the question:
"Is V2 architecture sufficient for a Ramses-class surface?"

**Answer:** No. V2 architecture is necessary (per current evidence) but
NOT sufficient. When depth is absent, the surface is dead regardless of
architectural pedigree.

Combined with Surface 7 (Base Aero V2 — ECONOMICALLY_BLOCKED on fees
despite V2 + depth), Pattern 2 now has two distinct failure modes
documented:

| Gate failed | Example | Wave |
|-------------|---------|------|
| Depth absent | Unichain Velo V2 ($88) | W7 |
| Fees too high | Base Aero V2 (37 bp floor) | W5 |
| Tight tracking | Base/Optimism Slipstream | W4, W6 |

### Boss variable necessity model (canonical, 2026-06-02)

| Variable | Necessary? | Direct counterexample |
|----------|-----------|----------------------|
| V2 architecture | Maybe | none yet |
| Depth (active-tick) | **Yes** | Unichain Velo V2 |
| Loose tracking | **Yes** | Base/Optimism Slipstream |
| Reasonable fees | **Yes** | Base Aero V2 |

Each gate now has a direct example of failure. The "V2 architecture
necessary?" question remains open — a CL surface achieving EXECUTION_READY
would falsify it.

### Novel structural observation

Unichain UniV3 fee-tier depth is INVERTED from the standard cross-chain
pattern. On Arbitrum/Optimism/Base the 0.05% tier is deepest for ETH/USDC;
on Unichain the 0.30% tier ($2.9M) is 20× deeper than the 0.05% tier
($143.7K). Hypothesis: Uniswap v4 captures most volume on its home chain,
forcing residual v3 liquidity into the higher-fee tier where LPs can break
even.

### Scoreboard post-W7

```
EXECUTION_READY        1
BEHAVIORALLY_DEAD      2
ECONOMICALLY_BLOCKED   1
STRUCTURALLY_DEAD      5
                       ──
n = 9 surfaces classified
```

Probability that another EXECUTION_READY surface exists somewhere:
~75% (down from ~80% post-W6). Direction of update: small but correct.

### Next: Wave 8 — Sonic

Sonic is the next test point for the Ramses-class question. Not because
Sonic is likely to win, but because every additional chain increases
confidence in the variable-necessity model.

## Wave 8 Result (2026-06-04)

**Surface:** Sonic wS/USDC × Shadow V3 ts=50 × Shadow V2 volatile
**Verdict:** `STRUCTURALLY_DEAD` (HIGH confidence, Boss C9 ruling 2026-06-04)
**Probe:** not run (V2 depth gate failure prevents behavioral test)

### Findings

Discovery measured Shadow V2 volatile pool TVL at **$79** — five-plus
orders of magnitude below Ramses (~$7M). Shadow V3 at ts=50 had
substantial $1.22M active-tick depth at 28 bps fee (per direct
`pool.fee()` read), but no V2 counterpart with adequate depth exists
in the Shadow ecosystem on Sonic.

Combined with the missing V2 partner, the surface fails the first
variable necessity gate (depth) before behavioral, distributional, or
fee analysis can yield any executable conclusion. Probe correctly
skipped — same logic as Unichain Wave 7.

### Wave 8 was the first chain investigated based on protocol lineage

Pre-Wave 8 chains (Base, Optimism, Unichain) were selected by L2
popularity/TVL. Sonic was selected because Shadow Exchange's xSHADOW
contract source code on SonicScan contains:

```solidity
import {IRamsesV3Pool} from "../CL/core/interfaces/IRamsesV3Pool.sol";
```

This is direct evidence that Shadow CL is built on the Ramses V3
codebase. Wave 8 tested whether following the protocol that produced
our EXECUTION_READY surface would lead to another.

**Conclusion:** Protocol lineage predicts WHERE to look — Shadow V3
exists on Sonic with $1.22M depth, exactly the Ramses-class CL we
hypothesized. Protocol lineage does NOT predict WHETHER the surface
will be viable — the V2 counterpart needed to test Pattern 4
behavioral signature is empty.

### Pattern 4 formalization (Boss canonical, 2026-06-04)

The hypothesis evolved through Wave 8 from a behavioral prediction to a
multi-requirement candidate class:

```
Pattern 4: Ramses-family candidate class

Requirements (all four must align):
  1. Ramses-family deployment
  2. Deep counterpart liquidity
  3. Loose-tracking behavior
  4. Favorable fee economics

Arbitrum Ramses:  4/4 → EXECUTION_READY
Sonic Shadow:     1/4 → STRUCTURALLY_DEAD (lineage only)

Status: UNRESOLVED — neither confirmed nor falsified
```

Confirmation requires another Ramses-family deployment where the V2
counterpart has Ramses-class depth, allowing the behavioral signature
to actually be measured.

### Variable necessity model — updated

After Wave 8, the canonical model now distinguishes operational
necessity from informational helpfulness:

| Variable | Necessary | Sufficient | Helpful for search? |
|----------|:---------:|:----------:|:--------------------|
| Depth | YES | No | — |
| Behavioral signature | YES | No | — |
| Spread distribution | YES | No | — |
| Fee structure | YES | No | — |
| **Protocol lineage** | No | No | **YES — predicts where to look** |

Protocol lineage is the first variable identified as HELPFUL but NOT
operationally necessary. A non-Ramses-family chain could theoretically
produce an EXECUTION_READY surface if all four operational variables
align. But Ramses-family chains are higher-prior search targets.

### Cross-chain emerging observation (Pattern 5 tentative — n=2)

Two chains launched/rebranded since ~late 2023 show the identical
V2-depth-absent failure:

| Chain | Launched | V2 fork depth | Verdict |
|-------|----------|---------------|---------|
| Unichain | 2024 | $88 (Velo V2) | STRUCTURALLY_DEAD |
| Sonic | 2024 rebrand | $79 (Shadow V2) | STRUCTURALLY_DEAD |

**Hypothesis (not yet promoted):** Modern chains skip V2 liquidity
because CL was already dominant at launch time. If this holds across
more chains, future investigations should bias toward chains launched
BEFORE ~2022 (Optimism 2021, Arbitrum 2021, Polygon 2020, BSC 2020,
etc.) where V2 forks had time to accumulate liquidity organically.

### Scoreboard post-W8

```
EXECUTION_READY            1
BEHAVIORALLY_DEAD          2
ECONOMICALLY_BLOCKED       1
STRUCTURALLY_DEAD          8   (5× Arbitrum + Unichain + Sonic + Mantle + Chronos)
                         ────
                          12   investigated

TIER_1_CATALOG (V4.1)      1   (SolidLizard, Arbitrum)
                         ────
n = 13 surfaces classified
```

### Strategic conclusion

The Wave 4-8 cumulative finding is that **the framework's discovery
process is working as designed**. Three distinct failure modes
(STRUCTURALLY_DEAD, BEHAVIORALLY_DEAD, ECONOMICALLY_BLOCKED) have been
documented before capital touched any of them. Each verdict was reached
by measurement rather than speculation.

The search continues for Surface #2. Sonic was not a winner, but Sonic
WAS the first surface selected because the framework predicted it might
be one. That methodological progress is more valuable than any
individual surface.

### Wave 9 — Mantle Cleopatra (concluded 2026-06-04)

Wave 9 investigated Mantle Cleopatra — an EXPLICITLY AUTHORIZED Ramses
fork (BUSL-1.1 licensed by Ramses) with the same AAA-prefix vanity
address convention as Arbitrum Ramses. Verdict: STRUCTURALLY_DEAD,
HIGH confidence. Max active-tick depth = $804 (Cleopatra Legacy
WMNT/USDC volatile), ~8,700× below Ramses-class threshold.

Wave 9 produced two empirical findings worth crystallizing:
1. Lineage does not predict factory ABI (Cleopatra CL uses standard
   UniV3, not Ramses V3 like Sonic Shadow V3).
2. Lineage does not predict depth (authorized fork with sophisticated
   CREATE2 deployment still has dust liquidity).

Pattern 5 strengthens to n=3 across chain generations (Unichain 2024,
Sonic 2024-rebrand, Mantle 2023). Ramses-family V2 outside Arbitrum
does not accumulate Ramses-class depth. HIGH confidence.

Pattern 4 (Ramses candidate class) — three external deployments all
failed the depth gate before behavioral test could run. Pattern 4
remains unresolved but DOWNGRADED as a primary search strategy.

### Wave 10A — Arbitrum intra-ecosystem Solidly V2 test (concluded 2026-06-05)

Wave 10A pivoted from broader-hunt to intra-chain — Boss directed
"test whether Arbitrum is the hidden variable" before any further
chain expansion. The test had two comparators:

**Chronos V1** (measured): $230M peak TVL (April 2023) → $78.6K
collapse. WETH/USDC.e volatile active-tick depth = $9,300, ~750×
below Ramses-class threshold. STRUCTURALLY_DEAD, HIGH confidence.
USDC.e confounder noted in archive (Chronos predates native USDC
on Arbitrum; stablecoin migration may have contributed to LP
flight alongside Ramses-specific weakness).

**SolidLizard** (cataloged under V4.1): ~$35K TVL since January 2023
inception. Tier 1 — Catalog Only under V4.1 RULE 1; no integration,
no discovery, no probe. "Failed to launch" pattern with NO migration
confounder, providing a cleaner intra-Arbitrum evidence point.

**Pattern 6 emerging (n=2 intra-Arbitrum):** Both forks fail the
depth gate. Combined with Pattern 5 (n=3 chain-external: Sonic,
Unichain, Mantle), the project has 5 non-Ramses Solidly V2
deployments across 4 chains, all failing the depth gate.

**Constitutional upgrade mid-wave:** Wave 10A produced Discovery
Constitution V4.1 (commit 1ad113d). The framework now operates
"classify first, investigate only if promoted" — the inverse of
the prior "investigate first, classify later" pattern.

**Ramses uniqueness formalized:** The Boss-directed Wave 10A
objective concludes that Ramses-on-Arbitrum is a singular phenomenon,
not a reproducible architectural property. See
`docs/research/ramses_class_surface_characteristics.md` Ramses
uniqueness section.

### Next: Wave 10B — opportunity-class tracks under V4.1

Per V4.1 (and Boss ruling 2026-06-05), the project formally retires
the question:

> "Can we find another Ramses?"

and replaces it with:

> "What opportunity classes remain underexplored?"

Wave 10B will be organized around **opportunity classes**, not
chains. Suggested tracks:

| Track | Class | Focus |
|-------|-------|-------|
| A | Cross-DEX Arbitrage | Continued, but only on Tier 2+ surfaces — likely off-Arbitrum chains with mature non-Solidly DEXes |
| B | Flash Loan Arbitrage | New lane: identify borrow sources + execution routes + repayment routes |
| C | Triangular Arbitrage | ETH → USDC → ARB → ETH and similar across already-integrated venues |
| D | Stablecoin Basis | Chronos exposed this lane (USDC.e variants); also USDC/DAI/USDe |
| E | LSD Arbitrage | mETH / cmETH / stETH and similar derivatives |
| F | Inventory Arbitrage | Already partially developed; needs persistence data from extended runs |
| G | Liquidity Migration | USDC.e → native USDC patterns; protocol-decay flows (Chronos, SolidLizard data points) |
| H | Directional / Scalping Research | Future phases; benefits from discovery data already collected |

V4.1 RULE 6 holds throughout: capital LOCKED, broadcast LOCKED,
proven winner UNTOUCHED until any new surface satisfies all
execution gates.

See `docs/specs/DISCOVERY_CONSTITUTION_V4_1.md` for the full V4.1
framework.


---

## Wave 10B — Capturability as first-class dimension (2026-06-05)

Wave 10B contained no new surface classifications. It built the
analytical machinery for opportunity classes A, B, C, D under
Discovery Constitution V4.1 and produced two thesis-level architectural
findings.

### Finding 1: Capturability is separate from instantaneous economics

Prior thesis (Waves 1-10A) focused on the four viability variables:
depth, tracking quality, spread distribution, fee floor. All four
address instantaneous economics — is this surface economically viable
at some observed moment?

Wave 10B introduced a fifth axis: **capturability**. Given that a
surface IS instantaneously economic, can that opportunity actually be
captured given detection latency and execution mechanics? A 40 bp
opportunity that survives one block is captured differently than a
40 bp opportunity that survives thirty blocks. A candidate that shows
up frequently but never crosses the executable threshold (Boss's
predicted "showy but useless" diagnostic) is not the same opportunity
as one that shows up rarely but reliably clears execution costs.

Capturability is measured through five persistence telemetry primitives:

1. **captureProfile** — descriptive taxonomy over observed economic
   run length: UNKNOWN_WINDOW / SAME_BLOCK_ONLY / SHORT_WINDOW /
   PERSISTENT_WINDOW.
2. **candidateHitRate vs economicHitRate** — the delta identifies
   surfaces showing frequent discrepancies with negligible executable
   yield.
3. **Latency survival buckets** — 0, +1, +2, +5, +10 blocks — describe
   how detection-to-execution delay affects capture probability.
4. **bindingConstraintTransitions** — whether a surface's bottleneck
   is static (safe to pre-lock size) or dynamic (requires
   revalidation).
5. **UTC hour recurrence histogram** — captures event timing patterns
   without prescribing execution windows.

**Constitutional principle:** These metrics are DESCRIPTIVE, not
prescriptive. The router uses them to reason, not to instruct. No
threshold on any of these five collapses into an execution rule
without explicit Boss ruling.

### Finding 2: Atomicity and financing are orthogonal dimensions

Prior thesis treated "flash-loan-viable" and "atomic-only" as
overlapping concepts. Wave 10B (Boss C9 explicit correction) established
these as ORTHOGONAL:

- **Atomicity** = does the opportunity require single-transaction
  capture? Answered by captureProfile + latency survival, NOT by
  whether flash financing is available.
- **Financing** = where does the capital come from? Answered by
  inventoryCapable / flashEligible / flashBeneficial, NOT by whether
  the opportunity is atomic.

A SAME_BLOCK_ONLY opportunity requires atomic execution. It does NOT
automatically require flash financing — if inventory is sufficient
for the recommended size, atomic self-financed capture is a valid
mode. Conversely, a PERSISTENT_WINDOW opportunity may still benefit
from flash financing if capital-constrained, even though the surface
doesn't demand atomicity.

**Constitutional principle:** Class B (financing overlay) is not the
same as "atomic execution." The router composes them independently:
`opportunityClass = ["A", "B"]` means "cross-DEX arb, flash-financed."
Nothing in that composition asserts atomicity — the captureProfile
field is separate and independent.

### Framework refinement implication

The variable-necessity model (Wave 7 canonical) was:

> Depth + Behavioral signature + Spread distribution + Fee floor
> — all four must align for EXECUTION_READY.

Wave 10B adds:

> When the four variables align, EXECUTION_READY is contingent on
> capturability being demonstrable through observed persistence data
> and on the financing/inventory decision being economically justified
> against that capturability profile.

The four instantaneous variables classify a surface. The capturability
axis + financing dimensions determine how that surface should be
routed for execution planning. The distinction is not cosmetic — it
enables the router to correctly SKIP surfaces whose fixture output
LOOKS economic but whose empirical telemetry shows never actually
clearing the executable threshold.

### Machinery vs findings

**Machinery:** the c5 aggregator and c6 router implement the
capturability axis and financing orthogonality. Both run against
deterministic fixture corpora and produce reproducible decisions.

**Findings:** Wave 10B produced NO new empirical findings about real
market surfaces. All six behavioral observations documented in the
research notebook are ABOUT THE MACHINERY, not about real markets.

Wave 11 (live telemetry wiring) will produce the first empirical
findings under the capturability framework. The constitutional
objective is:

> "Replace synthetic confidence with empirical confidence without
>  changing capital or execution posture."

Capital, execution, and broadcast remain LOCKED throughout Wave 10B
and will remain LOCKED throughout Wave 11.

### Cross-reference

- Full architectural summary: [`docs/waves/wave_10b_summary.md`](../waves/wave_10b_summary.md)
- Router implementation: `scripts/router/opportunity_router.js`
- Research notebook (Wave 10B machinery findings): [`docs/research/ramses_class_surface_characteristics.md`](../research/ramses_class_surface_characteristics.md)
