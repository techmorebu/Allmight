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
