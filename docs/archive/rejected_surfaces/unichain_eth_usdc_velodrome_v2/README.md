# Unichain ETH/USDC × Velodrome V2 — STRUCTURALLY_DEAD

**Verdict:** `STRUCTURALLY_DEAD`
**Confidence:** HIGH
**Boss C9 ruling:** 2026-06-02
**Wave:** W7
**Probe:** not run (depth alone decisive)

---

## Surface

- **Chain:** Unichain (chainId 130)
- **Pair:** ETH/USDC
- **Dominant venue:** UniV3 0.30% (deepest)
- **Tracking venue:** Velodrome V2 (volatile pool)
- **UniV3 factory:** `0x1f98400000000000000000000000000000000003`
  (NOT canonical 0x1F98431c — Unichain-specific, per Uniswap docs)
- **Velodrome V2 factory:** `0x31832f2a97Fd20664D76Cc421207669b55CE4BC0`
- **Velodrome V2 ETH/USDC volatile pool:** `0x13a6BC52C243a809394F3F656606213AEBd3e84D`

---

## Discovery results (2026-06-02, block 49632120)

| Pool | Fee | Active-tick depth | Price |
|------|----:|------------------:|------:|
| UniV3 `0x52393e96...` | 0.01% | $37 | $1989.55 |
| UniV3 `0x65081CB4...` | 0.05% | $143,700 | $1984.90 |
| UniV3 `0x89270589...` | 0.30% | $2,923,600 | $1987.80 |
| UniV3 `0xFF9722Cb...` | 1.00% | $33 | $1982.32 |
| Velodrome V2 `0x13a6BC52...` | 30 bps | **$88** | $1997.04 |

Price spread across pools: ~0.8% (sanity check on `priceMode='invert'` passes).

---

## Why STRUCTURALLY_DEAD

The critical number: **Velodrome V2 active-tick depth = $88.**

Comparison points:

| Surface | Active-tick depth | Status |
|---------|------------------:|--------|
| Arbitrum Ramses (EXECUTION_READY) | ~$7,000,000 | Proven viable |
| Unichain Velodrome V2 | **$88** | STRUCTURALLY_DEAD |

Ratio: ~79,500× smaller than the only proven EXECUTION_READY counterpart.

Even if Unichain exhibited the most favorable behavioral lag signature
ever observed on the project, there is insufficient executable liquidity
for the surface to matter. The constitutional framework's purpose
includes avoiding wasted probe time on surfaces where viability is
already disproven by earlier gates. This is one of those cases.

Additional gates that also fail:

- **Combined economic floor:** ~60+ bps (UniV3 5 bp + Velo V2 30 bp + gas + slippage)
  - Compared to ~10 bp on Ramses, the floor alone would consume most lag
- **Velodrome V2 fee:** 30 bps (6× Ramses's 5 bps)

---

## Framework contribution

This surface is the n=1 direct counterfactual for the question:
**"Is V2 architecture sufficient for a Ramses-class surface?"**

Answer: **No.** V2 architecture is necessary (per current evidence) but
NOT sufficient. When depth is absent, the surface is dead regardless of
architectural pedigree.

This strengthens **Pattern 2** in the research notebook from "necessary
but not sufficient (1 ECONOMICALLY_BLOCKED case)" to "necessary but not
sufficient (1 ECONOMICALLY_BLOCKED + 1 STRUCTURALLY_DEAD case)".

The Boss model now formalizes variable necessity:

| Variable | Necessary? | Counterexample |
|----------|-----------|----------------|
| V2 architecture | Maybe | (no counterexample yet) |
| Depth | Yes | This surface (Unichain Velo V2 $88) |
| Loose tracking | Yes | Base/Optimism Slipstream (BEHAVIORALLY_DEAD) |
| Reasonable fees | Yes | Base Aero V2 (ECONOMICALLY_BLOCKED) |

Each gate now has a direct example of failure.

---

## Novel structural observation about Unichain

UniV3 fee-tier depth distribution on Unichain is INVERTED from the
pattern observed on Arbitrum, Optimism, and Base:

| Chain | Deepest tier for ETH/USDC | Notes |
|-------|---------------------------|-------|
| Arbitrum | 0.05% (~$7M+) | Standard pattern |
| Optimism | 0.05% (~$1.5M+) | Standard pattern |
| Base | 0.05% (~$10M+) | Standard pattern |
| **Unichain** | **0.30% ($2.9M)** — 20× deeper than 0.05% | **Inverted** |

Hypothesis (not tested): with Uniswap v4 capturing the bulk of volume
on Unichain (Uniswap's own L2), remaining v3 liquidity migrated to the
higher-fee tier where LPs can break even on lower v3 volume. Worth
logging for future Unichain investigations.

---

## Files in this archive

- `README.md` — this file
- `discovery_output.log` — discovery script raw output

(No probe data — probe not run per C9 ruling reasoning.)

---

## Cross-references

- Project ledger: [../../project_ledger.md](../../project_ledger.md)
- Research notebook: [../../research/ramses_class_surface_characteristics.md](../../research/ramses_class_surface_characteristics.md)
- Thesis: [../../thesis/behavioral_signature.md](../../thesis/behavioral_signature.md)
