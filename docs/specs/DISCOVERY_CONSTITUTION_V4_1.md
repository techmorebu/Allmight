# Project AllMight — Discovery Constitution V4.1

**Status:** ACTIVE (locked-in 2026-06-05)
**Boss ruling:** C9 2026-06-05
**Supersedes:** the implicit V1-V3 "investigate then classify" operator
behavior used in Waves 1-10A
**Applies to:** all discovery work from Wave 10B forward

---

## Purpose

The purpose of discovery is **NOT** to maximize the number of chains,
protocols, or integrations investigated.

The purpose of discovery is to:

> Maximize executable opportunity identification while minimizing
> operator time, integration effort, and capital risk.

A surface must **earn** deeper investigation.

Discovery is no longer chain-driven.
Discovery is opportunity-driven.

---

## The maturity milestone (why V4.1 exists)

After 10 waves and 13 classified surfaces, the framework has generated
enough evidence to justify changing operator behavior.

The old framework:
> "Investigate first, classify later."

The new framework:
> "Classify first, investigate only if promoted."

This is not drift from the original AllMight constitution. It is a
tightening. The original mission was always:

> Find durable, executable market inefficiencies that can safely
> compound capital.

V4.1 removes the wasted-effort path of investigating Tier 0/1 surfaces
that the pre-screen could have rejected.

---

## RULE 1 — CLASSIFY BEFORE INTEGRATE

Every candidate surface shall be assigned a preliminary tier **before
any code integration work begins**. Tier is derived from public
metrics (DefiLlama TVL, DexScreener volume, protocol analytics).

| Tier | Estimated depth | Action |
|------|-----------------|--------|
| Tier 0 | < $1,000 | **Auto-Reject.** Archive. No Integration. No Discovery. |
| Tier 1 | $1,000 – $100,000 | **Catalog only.** No Integration. No Probe. |
| Tier 2 | $100,000 – $1,000,000 | **Discovery Eligible.** Integration permitted. |
| Tier 3 | $1,000,000 – $5,000,000 | **Probe Eligible.** Full investigation. |
| Tier 4 | > $5,000,000 | **Execution-Class Candidate.** |

Operational note: "estimated depth" is the public proxy for active-tick
depth at the canonical USD-pair. Where TVL is the only available
metric, divide by the venue's pair count to approximate per-pair depth.
TVL across all pairs is NOT a substitute for active-tick depth at the
target pair — but it is a useful upper bound for pre-screen tier
assignment.

---

## RULE 2 — OPPORTUNITY FIRST

The primary discovery question becomes:

> "What opportunity class can this surface support?"

NOT:

> "Can this surface become another Ramses?"

Every surface must receive opportunity-class tags.

### Opportunity Classes

| Class | Description |
|-------|-------------|
| A | Cross-DEX Arbitrage (the project's current specialty: UniV3 ↔ V2, CL ↔ CL, V2 ↔ V2) |
| B | Flash Loan Arbitrage (borrow source + execution route + repayment route) |
| C | Triangular Arbitrage (e.g., ETH → USDC → ARB → ETH) |
| D | Stablecoin Basis (USDC / USDC.e / USDT / DAI / USDe variants) |
| E | LSD Arbitrage (mETH / cmETH / stETH / ETH derivatives) |
| F | Inventory Arbitrage (frequency + persistence + repeatability) |
| G | Liquidity Migration (e.g., USDC.e → native USDC; Protocol A → Protocol B) |
| H | Directional / Scalping / Accumulation Research (future phases) |

A surface that fails Class A may still be valuable for Class B, D, G,
or H. Opportunity-class tags preserve intelligence value across all
archived surfaces.

---

## RULE 3 — HARD GATES

Any surface failing a gate stops immediately. No probe, no execution,
no exception.

### Gate A — Liquidity Threshold

Surface tier must be ≥ Tier 2 for integration to proceed.

### Gate B — Counterpart Depth Ratio

Calculate immediately after discovery:

```
Counterpart Depth Ratio = Counterpart Depth / Dominant Depth
```

Ratio < 1% → **Structural Failure.** Archive immediately.

Examples that would have terminated instantly under V4.1:
- Sonic Shadow V2 vs Shadow V3: $79 / $1,223,100 = 0.006% → STRUCTURAL_FAILURE
- Unichain Velodrome V2 vs UniV3: $88 / large = far below 1%
- Mantle Cleopatra Legacy vs Cleopatra CL: $804 / $23 (CL was dust too)

### Gate C — Economic Viability

Before any probe:

```
Spread Potential > Fee Floor
```

must hold. If not → **ECONOMICALLY_BLOCKED.** Immediate stop.

### Gate D — Persistence

No persistence = no execution path. A surface with floor-crossing
events that occur once a month is not executable for compounding
capital, regardless of depth or spread.

---

## RULE 4 — LINEAGE IS A PRIOR

Protocol lineage may be used for discovery (where to look first).

Protocol lineage may NOT be used as evidence of viability.

Every deployment must be measured independently.

Empirical anchors from Wave 8/9 confirming this rule:

| Deployment | Lineage | ABI Surprise | Depth Surprise |
|-----------|---------|--------------|----------------|
| Sonic Shadow V3 | Ramses V3 fork | int24 tickSpacing (different from Ramses V2) | Shadow V2 counterpart $79 |
| Mantle Cleopatra CL | Authorized Ramses BUSL-1.1 fork | uint24 fee (STANDARD UniV3, NOT Ramses V3) | Cleopatra Legacy max $804 |
| Chronos V1 | Solidly V2 fork (not Ramses-lineage) | getPair (Solidly-legacy) | WETH/USDC.e $9,300 |

Three different lineage paths → three different ABI behaviors. Three
non-Ramses Solidly V2 forks on three chains → three failed depth gates.

Lineage = search prior. Empirical measurement = evidence.

---

## RULE 5 — ARCHIVES RETAIN VALUE

Archive does NOT mean useless.

Archive means:

> Not suitable for **the tested strategy**.

Archived surfaces remain available for:

- Flash Loan Research (Class B)
- Liquidity Migration (Class G)
- Stablecoin Studies (Class D)
- Inventory Systems (Class F)
- Future Scalping / Accumulation Models (Class H)
- Future AI Intelligence Layers

Every archive entry MUST carry opportunity-class tags. A surface that
is `STRUCTURALLY_DEAD` for Cross-DEX Arbitrage may be `OPEN` for
Liquidity Migration analysis.

---

## RULE 6 — CAPITAL PROTECTION

No constitutional change affects capital policy.

Capital remains:

```
LOCKED
UNTOUCHED
NON-BROADCASTING
```

until a surface satisfies **all execution gates** (Tier 4 + passes
Gates A-D + has counterpart with Ratio ≥ 1% + Spread > Fee Floor +
Persistence confirmed across multiple market regimes).

Discovery exists to protect capital through information advantage.

---

## Success Metric

The objective is **not**:

> More Integrations

The objective **is**:

> More Executable Opportunities
> Per Hour Of Investigation
> While Preserving Capital

---

## Retired questions

The following question is **formally retired** as of V4.1:

> "Can we find another Ramses?"

Replaced with:

> "What opportunity classes remain underexplored?"

Wave 10B and beyond should be organized around **opportunity classes**
rather than chains.

Suggested track structure for Wave 10B:

| Track | Focus |
|-------|-------|
| Track A | Cross-DEX Arbitrage (continued, but only on Tier 2+ surfaces) |
| Track B | Flash Loan Opportunities (new lane) |
| Track C | Stablecoin Basis (new lane — Chronos exposed this) |
| Track D | Liquidity Migration (USDC.e → USDC; protocol decay patterns) |
| Track E | Inventory Arbitrage (partially developed; needs persistence data) |

---

## Implementation — what this means in practice

### For CPT (the assistant)

Before proposing any new chain or venue integration:

1. **Stage 0 — Ecosystem Recon (free).** Web search TVL, volume,
   protocol age, DEX count, liquidity concentration. NO CODE.
2. **Stage 1 — Surface Pre-Screen (free).** Estimate per-pair depth
   from public data (DefiLlama, DexScreener). Assign tier.
3. **Stage 2 — Tier Gate.**
   - Tier 0 → auto-reject, brief archive entry with opportunity-class
     tags showing why it's not Class A
   - Tier 1 → catalog-only archive (no integration), opportunity tags
   - Tier 2+ → propose integration to Boss; await approval
4. **Stage 3 — Boss approval.** No integration commit without explicit
   Tier-2+ approval.

### For Boss (the operator)

V4.1 does not change Boss's authority structure. Boss still rules on:
- Tier disputes
- Opportunity-class re-classifications
- Wave-level strategic direction
- Probe and execution decisions

V4.1 reduces the volume of Boss decisions by auto-handling Tier 0/1
surfaces.

### For the capital wallet

Unchanged. LOCKED. UNTOUCHED. NON-BROADCASTING.

---

## Cross-references

- Project ledger: [../project_ledger.md](../project_ledger.md)
- Research notebook: [../research/ramses_class_surface_characteristics.md](../research/ramses_class_surface_characteristics.md)
- Behavioral signature thesis: [../thesis/behavioral_signature.md](../thesis/behavioral_signature.md)
- Lessons: [../lessons/dex_contract_discovery_pitfalls.md](../lessons/dex_contract_discovery_pitfalls.md)
- Wave 8 Sonic archive (lineage-doesn't-predict-ABI evidence): [../archive/rejected_surfaces/sonic_shadow_v3_shadow_v2/README.md](../archive/rejected_surfaces/sonic_shadow_v3_shadow_v2/README.md)
- Wave 9 Mantle archive (lineage-doesn't-predict-depth evidence): [../archive/rejected_surfaces/mantle_cleopatra_cl_legacy/README.md](../archive/rejected_surfaces/mantle_cleopatra_cl_legacy/README.md)
- Wave 10A Chronos archive (USDC.e confounder + Solidly stable-curve pattern): [../archive/rejected_surfaces/chronos_v1_arbitrum/README.md](../archive/rejected_surfaces/chronos_v1_arbitrum/README.md)

## Version history

| Version | Date | Author | Change |
|---------|------|--------|--------|
| V4.0 (draft) | 2026-06-05 | Boss | Initial framework proposal (tiers, classes, sequence) |
| V4.1 (locked) | 2026-06-05 | Boss | Formal rules locked-in (RULE 1-6) before further Wave 10 work |
