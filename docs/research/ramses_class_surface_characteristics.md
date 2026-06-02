# Ramses-Class Surface Characteristics — Research Notebook

**Status:** ACTIVE (initialized 2026-06-02, Boss directive)
**Current sample:** n = 7 classified surfaces (1 EXECUTION_READY)
**Target sample:** n = 15-20 classified surfaces before strong claims about a predictive model

---

## Purpose

Catalog every classified surface across all chains and DEX families to:

1. Identify shared characteristics among `EXECUTION_READY` surfaces (currently n=1: Arbitrum Ramses)
2. Identify shared characteristics among `BEHAVIORALLY_DEAD` surfaces (currently n=2: Base + Optimism Slipstream)
3. Identify shared characteristics among `ECONOMICALLY_BLOCKED` surfaces (currently n=1: Base Aero V2)
4. Detect predictive variables — which features correlate with viability?
5. Build toward an empirically-grounded predictive model

**Boss's central research question (Wave 6 verdict, 2026-06-02):**

> "Is Ramses unique, or does another chain contain a second Ramses-class surface?"

This notebook is the data infrastructure that will eventually answer that question.

---

## Methodology

Each classified surface contributes a row. Fields are populated as data becomes available:

- **Structurally rejected surfaces** (`STRUCTURALLY_DEAD`) — depth/behavioral fields are N/A since no probe ran
- **Probed surfaces** — all fields populated
- **Provisional surfaces** — partial data with explicit `[provisional]` markers

Data sources (per row):
- Discovery output (depth, fee tiers, pool addresses)
- Probe output (spread distribution, lead/lag, depth stability)
- Boss C9 ruling (verdict, confidence)

---

## Schema

| Field | Description |
|-------|-------------|
| `#` | Sequence number |
| `Chain` | EVM chain |
| `Pair` | Token pair (ETH/USDC etc.) |
| `Dominant venue` | Price-discovery dominant pool (typically deepest or most active) |
| `Tracking venue` | The other side of the surface |
| `Pool types` | Architecture: V2 (constant product), V3 (CL with slot0), Slipstream (CL with extended slot0), Algebra |
| `Fees (D/T)` | Fee in bp for dominant / tracking venues |
| `Depth class` | Approximate active-tick depth USD — rough bucket |
| `Leader %` | Of single-venue tick changes, percent led by the noted leader |
| `Spread mean` | bp |
| `Spread max` | bp |
| `Spread p99` | bp |
| `Floor` | Economic floor in bp (fees + gas + slippage estimate) |
| `Wave` | Investigation wave |
| `Verdict` | Boss C9 ruling |

---

## Surface table (n = 7)

| # | Chain | Pair | Dominant venue | Tracking venue | Pool types (D/T) | Fees D/T (bp) | Depth (active-tick) | Leader | Spread mean | Spread max | Spread p99 | Floor (bp) | Wave | Verdict |
|---|-------|------|---------------|----------------|------------------|---------------|---------------------|--------|-------------|------------|------------|------------|------|---------|
| 1 | Arbitrum | ETH/USDC | UniV3 0.05% | Ramses V2 0.05% | V3 / V2 | 5 / 5 | ~$7M total* | UniV3 leads | ~8 bp | ~35 bp | n/a | ~10 | W2-3 | `EXECUTION_READY` |
| 2 | Arbitrum | ETH/USDT | UniV3 | Camelot V3 + SushiSwap V3 | V3 / Algebra+V3 | 5 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W2 | `STRUCTURALLY_DEAD` |
| 3 | Arbitrum | WBTC/USDC | UniV3 | SushiSwap V3 | V3 / V3 | 5 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W3 | `STRUCTURALLY_DEAD` |
| 4 | Arbitrum | DAI/USDC | UniV3 | Camelot V3 | V3 / Algebra | 1 / various | depth fail | n/a | n/a | n/a | n/a | n/a | W1 | `STRUCTURALLY_DEAD` |
| 5 | Base | ETH/USDC | UniV3 0.05% | Aerodrome Slipstream ts=100 | V3 / Slipstream | 5 / 4 | ~$509M (stable) | UniV3 leads (presumed) | ~1 bp | ~3 bp | ~2 bp | ~9 | W4 | `BEHAVIORALLY_DEAD` |
| 6 | Base | ETH/USDC | UniV3 0.05% | Aerodrome V2 volatile | V3 / V2 | 5 / 30 | ~$1-3M | UniV3 leads (bidirectional) | ~8 bp | 31.28 bp | ~25 bp | 37 | W5 | `ECONOMICALLY_BLOCKED` |
| 7 | Optimism | ETH/USDC | Velodrome Slipstream ts=100 | UniV3 0.05% | Slipstream / V3 | 1 / 5 | $19k-$351k (churn) | Velodrome leads 74.7% | 1.08 bp | 4.00 bp | 3.00 bp | 6 | W6 | `BEHAVIORALLY_DEAD` |

\* Active-tick depth not formally measured for Ramses in earliest waves; figure is approximate total TVL. Future measurement should use the post-Wave-4 active-tick probe methodology.

---

## Preliminary pattern observations (provisional, n=4 with complete behavioral data)

### Pattern 1: CL-family tracking efficiency

**Surfaces 5 and 7 (Base Slipstream and Optimism Velodrome Slipstream)** both classify
as `BEHAVIORALLY_DEAD` despite:
- Different depths ($509M vs. $19k-$351k churning)
- Different lead/lag patterns (UniV3-led on Base, Velodrome-led on Optimism)
- Different LP defense mechanisms (size-based vs. churn-based)

Common feature: **Slipstream pool type (Solidly-fork CL)**. The architecture itself appears
to produce efficient tracking regardless of depth or which side leads.

**Implication:** Future Solidly-fork CL surfaces on other chains likely classify as
`BEHAVIORALLY_DEAD`. The framework predicts this pattern. Confirmed once on Optimism.

### Pattern 2: V2-style architecture seems necessary (but not sufficient) for EXECUTION_READY

**Surface 1 (Arbitrum Ramses):** V2 architecture, EXECUTION_READY.
**Surface 6 (Base Aero V2):** V2 architecture, ECONOMICALLY_BLOCKED (lag exists, fee floor too high).

V2 architecture appears to create the LAG signature (Ramses + Aero V2 both lag UniV3 to some degree).
But V2 architecture alone doesn't guarantee viability — fees matter critically.

Aero V2's 30 bp fee tier kills the surface despite presence of a lag signature.
Ramses's 5 bp fee tier permits the surface despite similar architectural class.

**Implication:** Need to find V2-style surfaces with LOW fees (≤5-10 bp) on new chains.

### Pattern 3: Insufficient sample for cross-chain claims

At n=4 probed surfaces, claims about CL vs V2 family are still preliminary.
At n=2 EXECUTION_READY (currently n=1: Ramses), claims about Ramses-class uniqueness are NOT yet justified.

**Required:** more probes. Wave 7+ (Unichain, Sonic, Mantle) and possibly back-fill of
existing chains with additional pair candidates.

---

## Open questions for future investigation

1. **Lead/lag direction:** Wave 6 found Velodrome-led pattern on Optimism (74.7%).
   Was Base also Velodrome-led? We assumed UniV3-led but never explicitly measured.
   Retrospective probe data (Wave 4 JSONL) could be re-analyzed for lead/lag.

2. **Slipstream tickSpacing variation:** Our probes used ts=100 on both Base and Optimism.
   Does ts=50 or ts=200 behave differently? Worth investigating if discovery surfaces them.

3. **UniV3 fee tier choice:** All probed surfaces used UniV3 0.05% as the V3 leg.
   Would 0.30% behave differently? On Optimism, 0.30% has 18× more depth than 0.05%.

4. **Cross-mechanism convergence:** Aerodrome (size-based defense) and Velodrome
   (churn-based defense) reach the same `BEHAVIORALLY_DEAD` outcome. What's the
   deeper invariant — is it "any CL tracking system reaches efficient tracking"?

5. **V4 architecture:** Uniswap v4 (Singleton + Hooks) is fundamentally different from V3.
   Does it produce a different behavioral profile? Major infrastructure work required to test.

6. **Stablecoin pairs:** All surfaces tested are ETH/USDC. Are USDT/USDC or ETH/BTC pairs
   behaviorally different?

---

## Update protocol

Append a row when a new surface is classified. Update existing rows when refined data
arrives (e.g., retrospective lead/lag analysis on Base Wave 4 data).

Material findings get summarized in "Preliminary pattern observations." When a pattern
solidifies (n ≥ 3 confirmations), it can be promoted to the canonical thesis at
`docs/thesis/behavioral_signature.md`.

This notebook is the WORKING data layer. The thesis is the CRYSTALLIZED summary.

---

## Cross-references

- Project ledger: [docs/project_ledger.md](../project_ledger.md)
- Behavioral signature thesis: [docs/thesis/behavioral_signature.md](../thesis/behavioral_signature.md)
- Archive of rejected surfaces: [docs/archive/rejected_surfaces/](../archive/rejected_surfaces/)

