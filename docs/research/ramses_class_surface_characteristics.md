# Ramses-Class Surface Characteristics — Research Notebook

**Status:** ACTIVE
**Initialized:** 2026-06-02 (Boss directive, Wave 7 opening)
**Current sample:** n = 10 classified surfaces
**Target sample:** n = 15-20 classified surfaces before strong claims about a predictive model

---

## Purpose

Catalog every classified surface across all chains and DEX families to:

1. Identify shared characteristics among `EXECUTION_READY` surfaces (n=1)
2. Identify shared characteristics among `BEHAVIORALLY_DEAD` surfaces (n=2)
3. Identify shared characteristics among `ECONOMICALLY_BLOCKED` surfaces (n=1)
4. Identify shared characteristics among `STRUCTURALLY_DEAD` surfaces (n=6)
5. Detect predictive variables — which features correlate with viability?
6. Build toward an empirically-grounded predictive model

**Boss's central research question (Wave 6 verdict, reaffirmed post-Wave 8):**

> "Is Ramses unique, or does another chain contain a second Ramses-class surface?"

Refined post-Wave 8 to:

> "What combination of variables produces a Ramses-class surface?
>  Protocol lineage is necessary but not sufficient."

---

## Variable necessity model (Boss canonical, updated 2026-06-04)

After Wave 8, the model now includes protocol lineage as a HELPFUL but
NOT SUFFICIENT input:

| Variable | Necessary? | Sufficient? | Direct counterexample |
|----------|-----------|-------------|----------------------|
| Depth (active-tick) | **Yes** | No | Unichain Velo V2 $88; Sonic Shadow V2 $79 |
| Behavioral signature (loose tracking) | **Yes** | No | Base/Optimism Slipstream |
| Spread distribution | **Yes** | No | Base Aero V2 (max 31bp < 37bp floor) |
| Fee structure | **Yes** | No | Base Aero V2 (37bp combined floor) |
| Protocol lineage (Ramses-family) | No | No | Sonic Shadow (Ramses V3, fails depth) |
| V2 architecture | Maybe | No | (no CL EXECUTION_READY observed) |

**Boss principle (canonical 2026-06-04):**

> Protocol lineage is HELPFUL — it predicts where to LOOK.
> Protocol lineage is NOT SUFFICIENT — all four operational variables
> (depth, behavior, distribution, fees) must still align independently.

---

## Surface table (n = 10)

| # | Chain | Pair | Dominant venue | Tracking venue | Pool types (D/T) | Fees D/T (bp) | Depth (active-tick) | Leader | Spread mean | Spread max | Spread p99 | Floor (bp) | Wave | Verdict |
|---|-------|------|---------------|----------------|------------------|--------------:|---------------------|--------|------------:|-----------:|-----------:|-----------:|------|---------|
| 1 | Arbitrum | ETH/USDC | UniV3 0.05% | Ramses V2 0.05% | V3 / V2 | 5 / 5 | ~$7M total* | UniV3 leads | ~8 bp | ~35 bp | n/a | ~10 | W2-3 | `EXECUTION_READY` |
| 2 | Arbitrum | ETH/USDT | UniV3 | Camelot V3 | V3 / Algebra | 5 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W2 | `STRUCTURALLY_DEAD` |
| 3 | Arbitrum | ETH/USDT | UniV3 | SushiSwap V3 | V3 / V3 | 5 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W2 | `STRUCTURALLY_DEAD` |
| 4 | Arbitrum | WBTC/USDC | UniV3 | SushiSwap V3 | V3 / V3 | 5 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W3 | `STRUCTURALLY_DEAD` |
| 5 | Arbitrum | DAI/USDC | UniV3 | Camelot V3 | V3 / Algebra | 1 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W1 | `STRUCTURALLY_DEAD` |
| 6 | Base | ETH/USDC | UniV3 0.05% | Aerodrome Slipstream ts=100 | V3 / Slipstream | 5 / 4 | ~$509M (stable) | UniV3 leads (presumed) | ~1 bp | ~3 bp | ~2 bp | ~9 | W4 | `BEHAVIORALLY_DEAD` |
| 7 | Base | ETH/USDC | UniV3 0.05% | Aerodrome V2 volatile | V3 / V2 | 5 / 30 | ~$1-3M | UniV3 leads (bidirectional) | ~8 bp | 31.28 bp | ~25 bp | 37 | W5 | `ECONOMICALLY_BLOCKED` |
| 8 | Optimism | ETH/USDC | Velodrome Slipstream ts=100 | UniV3 0.05% | Slipstream / V3 | 1 / 5 | $19k-$351k (churn) | Velodrome leads 74.7% | 1.08 bp | 4.00 bp | 3.00 bp | 6 | W6 | `BEHAVIORALLY_DEAD` |
| 9 | Unichain | ETH/USDC | UniV3 0.30% | Velodrome V2 | V3 / V2 | 30 / 30 | UniV3 0.30%: $2.9M; **Velo V2: $88** | n/a (no probe) | n/a | n/a | n/a | ~60+ | W7 | `STRUCTURALLY_DEAD` |
| 10 | Sonic | wS/USDC | Shadow V3 ts=50 (Ramses V3) | Shadow V2 volatile | Ramses V3 / Solidly V2 | 28 / 30 | Shadow V3: **$1.22M**; **Shadow V2: $79** | n/a (no probe) | n/a | n/a | n/a | ~58+ | W8 | `STRUCTURALLY_DEAD` |

\* Active-tick depth not formally measured for Ramses in earliest waves; figure is approximate total TVL.

### Scoreboard

```
EXECUTION_READY        1   (Arbitrum Ramses)
BEHAVIORALLY_DEAD      2   (Base + Optimism Slipstream)
ECONOMICALLY_BLOCKED   1   (Base Aero V2)
STRUCTURALLY_DEAD      6   (4× Arbitrum + Unichain + Sonic)
                     ─────
total                 10
```

---

## Pattern observations

### Pattern 1: CL-family tracking efficiency (n=2 confirmations, predictive)

Surfaces 6 and 8 (Base Slipstream and Optimism Velodrome Slipstream) both
classify as `BEHAVIORALLY_DEAD` despite:
- Different depths ($509M vs. $19k-$351k churning)
- Different lead/lag patterns (UniV3-led on Base, Velodrome-led on Optimism)
- Different LP defense mechanisms (size-based vs. churn-based)

Common feature: **Slipstream pool type (Solidly-fork CL)**. The architecture
itself appears to produce efficient tracking regardless of depth or which
side leads. This was the framework's first predictive success — Base CL
behavior predicted Optimism CL outcome, confirmed by probe.

### Pattern 2: V2 architecture necessary but not sufficient (n=3 confirmations after W8)

V2 architecture alone does not guarantee viability. Multiple gates must
ALSO be passed (depth, tracking quality, fees).

Direct counterexamples now on record:
- **Surface 7 (Base Aero V2):** V2 present, depth ample, lag exists, but
  fees too high → `ECONOMICALLY_BLOCKED`
- **Surface 9 (Unichain Velo V2):** V2 present, but depth absent
  ($88 active-tick) → `STRUCTURALLY_DEAD`
- **Surface 10 (Sonic Shadow V2):** V2 present, but depth absent
  ($79 active-tick) → `STRUCTURALLY_DEAD`

The "V2 present + depth absent" failure mode now has n=2 confirmations
across distinct chains.

### Pattern 3: Unichain UniV3 fee-tier depth inversion (n=1, novel observation)

Standard fee-tier depth pattern (Arb/Op/Base for ETH/USDC): 0.05% deepest,
0.30% modest. **Unichain ETH/USDC pattern:** 0.30% tier ($2.9M) is 20×
deeper than the 0.05% tier ($143.7K). Inverted from the cross-chain norm.

Hypothesis: Uniswap v4 captures most volume on Unichain (Uniswap's own L2),
forcing residual v3 liquidity to migrate to higher-fee tier.

### Pattern 4: Ramses-family candidate class (Boss canonical, formalized W8)

The hypothesis evolved through Wave 8 from a single-variable test to a
multi-requirement candidate class definition.

**Requirements (all four must align for EXECUTION_READY):**

1. **Ramses-family deployment** — protocol lineage matches the proven
   Arbitrum Ramses architecture (V2 or V3)
2. **Deep counterpart liquidity** — V2 or alternative tracking venue
   must have Ramses-class depth (~$5M+ active-tick)
3. **Loose-tracking behavior** — CL repricing lags V2/tracking venue
   sufficiently to produce spreads above floor
4. **Favorable fee economics** — combined floor low enough that
   achievable spreads cross it

**Current evidence:**

| Surface | (1) Lineage | (2) Counterpart depth | (3) Loose tracking | (4) Fees | Verdict |
|---------|:-----------:|:---------------------:|:------------------:|:--------:|---------|
| Arbitrum Ramses | ✓ | ✓ | ✓ | ✓ | EXECUTION_READY |
| Sonic Shadow    | ✓ | ✗ | not tested | not tested | STRUCTURALLY_DEAD |

**Status:** Pattern 4 is **UNRESOLVED** — neither confirmed nor falsified.
Confirmation requires another Ramses-family deployment with sufficient
counterpart depth, where the behavioral signature can actually be probed.

### Pattern 5 (tentative — n=2 suggestive): Modern chains skip V2 architecture

Two chains launched/rebranded since ~late 2023 have shown the same
"V2 present + depth absent" pattern:

| Chain | Launched | V2 fork active depth | Verdict |
|-------|----------|---------------------:|---------|
| Unichain | 2024 | $88 (Velodrome V2) | STRUCTURALLY_DEAD |
| Sonic    | 2024 (rebrand) | $79 (Shadow V2) | STRUCTURALLY_DEAD |

**Hypothesis:** On chains launched after CL became the dominant DEX
architecture (~2023+), V2 forks exist for governance/token-launch reasons
but never accumulate meaningful liquidity. Capital flows directly to CL.

**Implication if pattern holds:** Searching for Ramses-class surfaces on
chains launched BEFORE ~2022 would be the higher-information search
strategy. Modern chains may not have the V2 partner the framework requires.

n=2 is suggestive only. Watch for confirmation or falsification in Wave 9+.

---

## Open questions for future investigation

1. **Pattern 4 confirmation/falsification.** Where is the next Ramses-
   family deployment with adequate V2 counterpart depth? Candidates:
   Ramses V2 on Mantle (if exists), other Ramses forks on older chains.

2. **Pattern 5 confirmation.** Wave 9+ chains: which have V2 forks
   with > $1M active depth? Mantle is older (2023) so V2 forks may
   have more historical accumulation than Sonic/Unichain.

3. **V2 architecture necessity.** No CL surface has achieved
   EXECUTION_READY (n=10). A CL EXECUTION_READY would falsify the V2
   necessity hypothesis. Worth keeping eyes open.

4. **Same-protocol vs cross-protocol surfaces.** Boss approved
   same-protocol pairing (Shadow V3 × Shadow V2) as a valid surface
   structure. The Pattern 4 hypothesis test on Sonic was same-protocol
   by design. If a future Ramses-family chain has cross-protocol
   counterparts available, would those produce different behavioral
   signatures than same-protocol?

5. **Active-tick depth threshold for EXECUTION_READY.** Arbitrum
   Ramses has ~$7M; Base Aero V2 ($1-3M) was ECONOMICALLY_BLOCKED on
   FEES not depth. The lower bound is unclear. A surface with $500k
   depth and good fees has never been tested.

---

## Probability estimates (Boss model, post-Wave 8)

| Event | Probability |
|-------|------------:|
| Another EXECUTION_READY surface exists somewhere | ~75% |
| ...on Mantle (Wave 9 candidate) | ~25% |
| ...on a pre-2022 chain | ~50% |
| Ramses is completely unique | ~25% |
| Pattern 4 (Ramses candidate class) is correct framing | ~70% |
| Pattern 5 (modern chains skip V2) holds at n=5 | ~50% |

Sonic was supposed to be the first test of Pattern 4. It tested the
LINEAGE requirement (✓) but failed the DEPTH gate (✗) before behavioral
signature could be probed. Pattern 4 confidence remains uncertain.

---

## Update protocol

Append a row when a new surface is classified. Update existing rows when
refined data arrives. Material findings get summarized in "Pattern
observations." When a pattern solidifies (n ≥ 3 confirmations), it can
be promoted to the canonical thesis at `docs/thesis/behavioral_signature.md`.

This notebook is the WORKING data layer. The thesis is the CRYSTALLIZED
summary.

---

## Cross-references

- Project ledger: [../project_ledger.md](../project_ledger.md)
- Behavioral signature thesis: [../thesis/behavioral_signature.md](../thesis/behavioral_signature.md)
- Archive of rejected surfaces: [../archive/rejected_surfaces/](../archive/rejected_surfaces/)
