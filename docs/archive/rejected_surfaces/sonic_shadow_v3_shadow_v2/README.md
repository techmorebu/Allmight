# Sonic wS/USDC × Shadow V3 × Shadow V2 — STRUCTURALLY_DEAD

**Verdict:** `STRUCTURALLY_DEAD`
**Confidence:** HIGH
**Boss C9 ruling:** 2026-06-04
**Wave:** W8
**Probe:** not run (depth gate failure prevents behavioral test)

---

## Surface

- **Chain:** Sonic (chainId 146, standalone L1 — Fantom successor)
- **Pair:** wS/USDC (Circle native USDC, NOT USDC.e)
- **Dominant venue (candidate):** Shadow V3 ts=50 (Ramses V3 fork)
- **Tracking venue (candidate):** Shadow V2 volatile (Solidly V2 fork)
- **Shadow V3 factory:** `0xcD2d0637c94fe77C2896BbCBB174cefFb08DE6d7`
- **Shadow V2 factory:** `0x2dA25E7446A70D7be65fd4c053948BEcAA6374c8`

---

## Discovery results (2026-06-04, block 72,434,879)

### Shadow V3 wS/USDC pools (6 tickSpacings tested)

| tickSpacing | Pool | Active-tick depth | Liquidity |
|------------:|------|------------------:|----------:|
| 1   | `0x0bDf86eda8...` | $0 | empty |
| 5   | `0x464cca9FC5...` | $0 | empty |
| 10  | `0x53807090...`   | $0 | empty |
| **50**  | `0x324963c267...` | **$1,223,100** | 3.32e18 |
| 100 | `0xeAA89d6319...` | $0 | empty |
| 200 | `0x6fD097d14D...` | $0 | empty |

Only the ts=50 pool has meaningful liquidity. All other tickSpacings on
Shadow V3 wS/USDC are factory-created but unused.

Actual per-pool fee (from direct `pool.fee()` call in Step 3B diagnostic):
**2,795 pips = 0.2795%** (28 bps).

Note: discovery output's reported fee of 0.0050% is a display bug for
ramses_v3 venues — the script shows tickSpacing as fee. Actual fee
came from direct on-chain reads. Display fix queued in follow-up commit.

### Shadow V2 wS/USDC pools

| Pool type | Address | wS reserve | USDC reserve | TVL |
|-----------|---------|-----------:|-------------:|----:|
| volatile  | `0x23EfA8092dab...` | 1,149.95 | $39.59 | **$79** |
| stable    | `0x2dB8E07FdAE...` | 1.98 | $0.02 | ~$0 |

Both pools exist structurally but are essentially empty. The volatile pool
shows the correct wS price ($0.0344 — matches Shadow V3 $0.0344) but has
near-zero liquidity. The stable pool is abandoned (dust reserves with
stale pricing).

### wS/USDC.e

No pools exist on Shadow V3 at any tickSpacing (6 zero-address returns).
USDC.e is effectively deprecated for wS pairing on the Shadow ecosystem.

---

## Why STRUCTURALLY_DEAD

The critical number: **Shadow V2 volatile active-tick depth = $79.**

Comparison points:

| Surface | V2 depth | Status |
|---------|---------:|--------|
| Arbitrum Ramses V2 (EXECUTION_READY) | ~$7,000,000 | Proven viable |
| Unichain Velodrome V2 (STRUCTURALLY_DEAD) | $88 | Recent precedent |
| **Sonic Shadow V2 (this surface)** | **$79** | This verdict |

Ratio: ~88,608× smaller than the executable threshold. Smaller even than
Unichain Velo V2 ($88).

Per Boss's variable necessity model, the depth gate is the FIRST gate
that must pass before any behavioral, distributional, or fee analysis
can yield viable execution. With $79 of executable counterpart depth,
no lag signature can compensate. The probe correctly skipped.

This is the project's SECOND case of "V2 architecture present but V2
counterpart depth absent" — Unichain Velo V2 was the first, Sonic
Shadow V2 the second.

---

## Framework contribution

### What we proved

**Protocol lineage is HELPFUL but NOT SUFFICIENT.**

Pre-Sonic the project had:
- Arbitrum Ramses V2 → EXECUTION_READY

Post-Sonic we now know:
- Ramses-family CL (Shadow V3) exists on a second chain
- Ramses-family CL counterpart V2 (Shadow V2) is empty
- → Ramses lineage doesn't guarantee a viable surface

This is direct evidence for the principle that all four variables
(depth × behavior × distribution × fees) must align. Lineage is a
useful PRIOR — it predicts where to LOOK — but doesn't predict
whether the surface will be viable.

### What we couldn't test

**Pattern 4 (Ramses-family loose tracking) — UNRESOLVED.**

Pattern 4 was the central Wave 8 hypothesis: do Ramses-family CL
deployments exhibit loose-tracking behavior similar to the Arbitrum
Ramses V2 EXECUTION_READY surface?

We have Shadow V3 (Ramses-family CL) on Sonic with $1.22M active depth.
That's a Ramses-class CL ready for testing.

But Pattern 4 requires testing CL vs a V2 counterpart with meaningful
depth. Shadow V2's $79 fails the depth gate. The behavioral test cannot
proceed; we never learn whether Shadow V3 would have produced the
loose-tracking signature characteristic of the Arbitrum Ramses surface.

Pattern 4 remains UNCONFIRMED and UNFALSIFIED.

### Boss-canonical updated Pattern 4 formulation (2026-06-04)

```
Pattern 4: Ramses-family candidate class

Requirements (all four must align):
  1. Ramses-family deployment        (Shadow V3 confirms)
  2. Deep counterpart liquidity      (Shadow V2 fails)
  3. Loose-tracking behavior         (not tested)
  4. Favorable fee economics         (Shadow V3 = 28 bp; not tested in surface)

Arbitrum Ramses surface:  passes 4/4
Sonic Shadow surface:     passes 1/4 (lineage only)

Status: UNRESOLVED
```

---

## Cross-chain emerging observation (tentative — n=2)

| Chain | Launch | V2 fork depth (wS/ETH × USDC) | Verdict |
|-------|--------|-------------------------------:|---------|
| Unichain | 2024 | $88 (Velodrome V2) | STRUCTURALLY_DEAD |
| Sonic    | 2024 (rebrand) | $79 (Shadow V2) | STRUCTURALLY_DEAD |

Both recently-launched/rebranded chains exhibit the same pattern: V2 fork
deploys structurally (factory + pools created) but accumulates effectively
zero liquidity. Capital migrates directly to CL.

**Hypothesis (not formalized):** On chains launched after CL became the
dominant DEX architecture (~2023+), V2 forks may exist for governance/
token-launch reasons but never accumulate liquidity. If true, this would
suggest **investigating Ramses-class surfaces on chains launched before
~2022** is the higher-information search strategy.

Not enough data to confirm (n=2). To watch in Wave 9 onward.

---

## Project state contribution

Surface count: **n = 9 → n = 10**

Updated scoreboard:

```
EXECUTION_READY        1   (Arbitrum Ramses)
BEHAVIORALLY_DEAD      2   (Base + Optimism Slipstream)
ECONOMICALLY_BLOCKED   1   (Base Aero V2)
STRUCTURALLY_DEAD      6   (4× Arbitrum + Unichain + Sonic)
                     ─────
total                 10
```

Probability priors (Boss canonical post-Wave 8, awaiting formal update):
- Another EXECUTION_READY exists somewhere: still ~75% (no major update)
- Ramses-family candidate class confirmed but unresolved: data point
- "Modern chains skip V2" observation: tentative, n=2

---

## Files in this archive

- `README.md` — this file (verdict + reasoning + framework contribution)
- `discovery_output.log` — Step 3C discovery raw output (block 72,434,879)
- `shadow_v2_depth_check.log` — manual V2 depth measurement (filled gap
  caused by discovery dispatch limitation)

No probe data — probe not justified per Boss ruling 2026-06-04.

---

## Cross-references

- Project ledger: [../../project_ledger.md](../../project_ledger.md)
- Research notebook: [../../research/ramses_class_surface_characteristics.md](../../research/ramses_class_surface_characteristics.md)
- Thesis: [../../thesis/behavioral_signature.md](../../thesis/behavioral_signature.md)
- Sonic factory verification: `scripts/research/sonic_factory_verification.js` (wave8 commit 2)
- Shadow V3 pool ABI diagnostic: `scripts/research/sonic_pool_abi_diagnostic.js` (wave8 commit 4)

## Pre-archive commit chain

```
5ed5093  wave8(commit 1): chain integration — pure config
a6e4852  wave8(commit 2): factory verification diagnostic (Ramses V3 ABI confirmed)
0eb8bdf  wave8(commit 3): introduce ramses_v3 venue type (Step 3A)
e5fe6ea  wave8(commit 4): shadow V3 pool ABI diagnostic (Step 3B)
88f047a  wave8(commit 5): register sonic in provider_factory (Step 3C unblocker)
```
