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
