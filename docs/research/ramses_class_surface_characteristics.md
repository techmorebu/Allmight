# Ramses-Class Surface Characteristics — Research Notebook

**Status:** ACTIVE
**Initialized:** 2026-06-02 (Boss directive, Wave 7 opening)
**Current sample:** n = 9 classified surfaces
**Target sample:** n = 15-20 classified surfaces before strong claims about a predictive model

---

## Purpose

Catalog every classified surface across all chains and DEX families to:

1. Identify shared characteristics among `EXECUTION_READY` surfaces (n=1)
2. Identify shared characteristics among `BEHAVIORALLY_DEAD` surfaces (n=2)
3. Identify shared characteristics among `ECONOMICALLY_BLOCKED` surfaces (n=1)
4. Identify shared characteristics among `STRUCTURALLY_DEAD` surfaces (n=5)
5. Detect predictive variables — which features correlate with viability?
6. Build toward an empirically-grounded predictive model

**Boss's central research question (Wave 6 verdict, 2026-06-02):**

> "Is Ramses unique, or does another chain contain a second Ramses-class surface?"

---

## Variable necessity model (Boss canonical, 2026-06-02)

After Wave 7, each gate now has a direct counterfactual:

| Variable | Necessary? | Direct counterexample |
|----------|-----------|----------------------|
| V2 architecture | Maybe | none yet (no CL surface has been EXECUTION_READY) |
| Depth (active-tick) | **Yes** | Unichain Velo V2 — $88 depth → STRUCTURALLY_DEAD |
| Loose tracking | **Yes** | Base/Optimism Slipstream — tight tracking → BEHAVIORALLY_DEAD |
| Reasonable fees | **Yes** | Base Aero V2 — 37 bp floor → ECONOMICALLY_BLOCKED |

Each negative example independently kills the surface despite other variables being present. This is structural evidence that the model has the right gates.

The only remaining open variable is "V2 architecture." A CL-family surface
achieving EXECUTION_READY would falsify the "V2 necessary" hypothesis.
None has been observed in n=9.

---

## Surface table (n = 9)

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

\* Active-tick depth not formally measured for Ramses in earliest waves; figure is approximate total TVL.

### Scoreboard

```
EXECUTION_READY        1   (Arbitrum Ramses)
BEHAVIORALLY_DEAD      2   (Base + Optimism Slipstream)
ECONOMICALLY_BLOCKED   1   (Base Aero V2)
STRUCTURALLY_DEAD      5   (4× Arbitrum + 1× Unichain)
                     ─────
total                  9
```

---

## Pattern observations

### Pattern 1: CL-family tracking efficiency (n=2 confirmations)

Surfaces 6 and 8 (Base Slipstream and Optimism Velodrome Slipstream) both
classify as `BEHAVIORALLY_DEAD` despite:
- Different depths ($509M vs. $19k-$351k churning)
- Different lead/lag patterns (UniV3-led on Base, Velodrome-led on Optimism)
- Different LP defense mechanisms (size-based vs. churn-based)

Common feature: **Slipstream pool type (Solidly-fork CL)**. The architecture
itself appears to produce efficient tracking regardless of depth or which
side leads.

**Implication:** Future Solidly-fork CL surfaces on other chains will
likely classify as `BEHAVIORALLY_DEAD`. n=2 confirmations is suggestive
but not yet conclusive.

### Pattern 2: V2 architecture necessary but not sufficient (n=2 confirmations after W7)

V2 architecture alone does not guarantee viability. Multiple gates must
ALSO be passed (depth, tracking quality, fees).

Direct counterexamples now on record:
- **Surface 7 (Base Aero V2):** V2 present, depth ample, lag exists, but
  fees too high → `ECONOMICALLY_BLOCKED`
- **Surface 9 (Unichain Velo V2):** V2 present, but depth absent
  ($88 active-tick) → `STRUCTURALLY_DEAD`

Combined with the positive example (Surface 1: Ramses on Arbitrum), the
model now has both a positive case AND multiple negative cases. Each
negative case kills a different variable.

### Pattern 3: Unichain UniV3 fee-tier depth inversion (novel observation, W7)

Standard fee-tier depth pattern (Arb/Op/Base for ETH/USDC): 0.05% deepest,
0.30% modest, others empty.

**Unichain ETH/USDC pattern:** 0.30% tier ($2.9M) is 20× deeper than the
0.05% tier ($143.7K). This is INVERTED from the cross-chain norm.

**Hypothesis (not tested):** Uniswap v4 captures most volume on Unichain
(Uniswap's own L2). Remaining v3 liquidity migrated to the higher-fee
tier where LPs can break even on lower v3 volume.

Implication: chain-by-chain fee-tier selection should not be automatic.
Future chain integrations should verify the deepest tier rather than
default to 0.05%.

---

## Open questions for future investigation

1. **V2 necessity:** Has any CL-family surface ever achieved EXECUTION_READY?
   At n=9, no — but the sample is small. A CL EXECUTION_READY would
   falsify the V2 necessity hypothesis. Sonic and Mantle (next waves)
   provide additional test points.

2. **Lead/lag direction:** Wave 6 found Velodrome-led pattern on Optimism
   (74.7%). Was Base also Velodrome-led? We assumed UniV3-led but never
   explicitly measured. Retrospective probe data (Wave 4 JSONL) could be
   re-analyzed for lead/lag.

3. **Slipstream tickSpacing variation:** Our probes used ts=100 on both
   Base and Optimism. Does ts=50 or ts=200 behave differently?

4. **UniV3 fee tier choice:** Unichain's inverted depth distribution
   (0.30% deeper) suggests chain-by-chain fee-tier selection should not
   be automatic.

5. **V4 architecture:** Uniswap v4 (Singleton + Hooks) is fundamentally
   different from V3. Does it produce a different behavioral profile?
   Major infrastructure work required to test.

6. **Cross-mechanism convergence:** Aerodrome (size-based defense) and
   Velodrome (churn-based defense) reach the same `BEHAVIORALLY_DEAD`
   outcome. What's the deeper invariant?

7. **Stablecoin pairs:** All probed surfaces are ETH/USDC. Are USDT/USDC
   or ETH/BTC pairs behaviorally different?

---

## Probability estimates (Boss model, post-Wave 7)

| Event | Probability |
|-------|------------:|
| Another EXECUTION_READY surface exists somewhere | ~75% |
| ...on Sonic | ~35% |
| ...on Mantle | ~25% |
| Ramses is completely unique | ~25% |

Uniqueness probability rose from ~20% (pre-W7) to ~25% (post-W7).
Direction is correct but sample remains too small to draw a conclusion.

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
