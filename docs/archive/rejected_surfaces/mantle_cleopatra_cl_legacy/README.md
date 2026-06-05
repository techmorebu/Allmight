# Mantle WETH/USDC + WMNT/USDC × Cleopatra CL × Cleopatra Legacy — STRUCTURALLY_DEAD

**Verdict:** `STRUCTURALLY_DEAD`
**Confidence:** HIGH
**Boss C9 ruling:** 2026-06-04
**Wave:** W9
**Probe:** not run (depth gate failure prevents behavioral test)

---

## Surface

- **Chain:** Mantle (chainId 5000, OP-Stack-derived L2, launched July 2023)
- **Pairs investigated:** WETH/USDC + WMNT/USDC (mETH/WETH deferred to Step 2/3 per Boss directive; never reached due to early closure)
- **Dominant venue (candidate):** Cleopatra CL (authorized Ramses fork, BUSL-1.1 licensed)
- **Tracking venue (candidate):** Cleopatra Legacy (Solidly V2 fork — Ramses V2 family lineage)
- **Cleopatra CL factory:** `0xAAA32926fcE6bE95ea2c51cB4Fcb60836D320C42`
- **Cleopatra Legacy factory:** `0xAAA16c016BF556fcD620328f0759252E29b1AB57`
- **Same AAA-prefix vanity address convention as Arbitrum Ramses** — direct evidence of coordinated sister-fork deployment by the original Ramses team or licensee

---

## ABI surprise (Step 2 finding)

Wave 9 Step 1 (`d589332`) registered Cleopatra CL with `type: ramses_v3` based on the lineage prior. Step 2 factory verification (`316995e`) REJECTED that prior:

- Cleopatra CL responds to **standard UniV3** `getPool(addr, addr, uint24 fee)` — NOT Ramses V3 (int24 tickSpacing)
- Pools discovered at standard UniV3 fee tiers: 100, 500, 3000, 10000 (basis points × 10000)

Empirical correction shipped as commit `1cf936e`:
- `chains.json`: `type: ramses_v3 → uniswap_v3`, `feeTiers: [1,5,10,50,100,200] → [100, 500, 3000, 10000]`
- Lesson logged at `docs/lessons/dex_contract_discovery_pitfalls.md`:
  > "Protocol lineage is a search prior. ABI behavior is an empirical fact."

Three Ramses-family deployments now have three different factory ABIs:

| Surface | Lineage | Factory ABI |
|---------|---------|-------------|
| Arbitrum Ramses V2 | original Ramses | Solidly `getPair()` V2 |
| Sonic Shadow V3 | Ramses V3 fork | `int24 tickSpacing` |
| Mantle Cleopatra CL | authorized Ramses fork (BUSL-1.1) | `uint24 fee` (standard V3) |

---

## Discovery results (2026-06-04, block 96,242,502)

### Cleopatra CL pools (4 pools, 2 pairs × 4 fee tiers tested)

| Pair | Fee | Pool | Active-tick depth | Notes |
|------|----:|------|------------------:|-------|
| WETH/USDC | 0.0500% | `0xC0b66C7535...` | $0 | below threshold |
| WETH/USDC | 0.3000% | `0xAAA87a36B9...` | **$23** | AAA-vanity (sophisticated CREATE2) |
| WMNT/USDC | 0.0100% | `0xB05088D53f...` | $0 | active pool but dust depth |
| WMNT/USDC | 1.0000% | `0x37a6B77F1a...` | (filtered) | L=0, MIN_TICK zombie |

Step 3 pool ABI diagnostic (`de9c782`) found:
- WETH/USDC pools (both fee tiers): observation cardinality 1000 — actively used as TWAP oracle source (mature usage)
- WMNT/USDC fee=100: cardinality 1 — never increased, no oracle consumers
- WMNT/USDC fee=10000: cardinality 3, tick = -887272 (MIN_TICK), L = 0 — uninitialized zombie pool

### Cleopatra Legacy pools (3 pools)

| Pair | Curve | Pool | Active-tick depth |
|------|-------|------|------------------:|
| WETH/USDC | volatile | `0xD6A00A4195...` | $0 (one reserve drained) |
| WMNT/USDC | volatile | `0x5c4de5FD6A...` | **$804** ← highest on entire Mantle surface |
| WMNT/USDC | stable | `0x6A817Dfe9a...` | $0 (misconfigured curve, displayed price $1000) |

The WMNT/USDC stable curve is anomalous — stable curves are designed for near-parity pairs (USDC/USDT). WMNT trades at $0.50-$0.93 against USDC, so a stable-curve WMNT/USDC pool is either misconfigured or unused.

### Filter summary
- 5 zero-address rejects (factory returned 0x0 for tested combos that never had pools)
- 1 zero-liquidity reject (WMNT/USDC fee=10000)

---

## Why STRUCTURALLY_DEAD

The critical number: **max active-tick depth on entire Mantle surface = $804** (Cleopatra Legacy WMNT/USDC volatile)

| Surface | Best depth | Status |
|---------|-----------:|--------|
| Arbitrum Ramses V2 (EXECUTION_READY) | ~$7,000,000 | Proven viable |
| Unichain Velodrome V2 (STRUCTURALLY_DEAD) | $88 | W7 |
| Sonic Shadow V2 (STRUCTURALLY_DEAD) | $79 | W8 |
| **Mantle Cleopatra Legacy (this surface)** | **$804** | This verdict (W9) |

Ratio: **~8,700× smaller** than the Ramses-class reference. About 10× larger than Sonic/Unichain V2 dust but still far below executable threshold ($5M+).

Per Boss's variable necessity model, the depth gate is the FIRST gate. With $804 of executable counterpart depth, no lag signature can compensate. The probe correctly skipped.

This is the project's THIRD case of "V2 architecture present but V2 counterpart depth absent" — Unichain Velo V2 (W7), Sonic Shadow V2 (W8), Mantle Cleopatra Legacy (W9).

---

## Framework contribution

### What we proved (twice in one wave)

**Lineage doesn't predict ABI.** Step 2 factory verification rejected the `ramses_v3` prior. Three Ramses-family deployments now have three different factory ABIs. Lineage is a search prior, not a predictor.

**Lineage doesn't predict depth.** Cleopatra is an *authorized* Ramses fork (BUSL-1.1 license from Ramses, sophisticated AAA-prefix CREATE2 deployment) and still has dust depth across all pools. Lineage is a search prior, not a predictor. (Documented twice in one wave.)

### What we couldn't test

**Pattern 4 (Ramses-family loose tracking) — UNTESTABLE.** Same outcome as Sonic Wave 8: the depth gate fails before behavioral test can run. We never learn what tracking signature Cleopatra would have produced.

Pattern 4 has now been TESTED FOR TESTABILITY three times across Sonic, Unichain, and Mantle. Three times the answer to "can we even test it?" has been NO.

### Boss C9 ruling — Pattern 4 downgraded as primary search strategy

> "Three external Ramses-family deployments failed before behavior could even be tested. That means lineage alone is weak. The next wave should broaden beyond Ramses-family."

New framing (Boss canonical, 2026-06-04):

```
Ramses lineage is a useful search prior,
but not the primary search strategy.
```

---

## Pattern 5 — strengthens to n=3

| Chain | Launched | V2 fork active depth | Verdict |
|-------|----------|---------------------:|---------|
| Unichain | 2024 | $88 (Velodrome V2 ETH/USDC) | STRUCTURALLY_DEAD |
| Sonic    | 2024 (rebrand) | $79 (Shadow V2 wS/USDC) | STRUCTURALLY_DEAD |
| **Mantle** | **July 2023** | **$804 (Cleopatra Legacy WMNT/USDC vol)** | STRUCTURALLY_DEAD |

The Pattern 5 refinement:

**Before Wave 9:** "Modern chains skip V2" (n=2, both 2024-launched/rebranded chains)
**After Wave 9:** "Ramses-family V2 outside Arbitrum does NOT accumulate Ramses-class depth" (n=3 across chain generations)

Mantle is older than Sonic and Unichain — the "modern chains" framing was incomplete. The deeper pattern is that the Arbitrum Ramses V2 outcome does not replicate to forks regardless of chain age. This is now a HIGH-CONFIDENCE finding.

---

## Project state contribution

Surface count: **n = 10 → n = 11**

Updated scoreboard:
```
EXECUTION_READY        1   (Arbitrum Ramses)
BEHAVIORALLY_DEAD      2   (Base + Optimism Slipstream)
ECONOMICALLY_BLOCKED   1   (Base Aero V2)
STRUCTURALLY_DEAD      7   (4× Arbitrum + Unichain + Sonic + Mantle)
                     ─────
total                 11
```

Strategic implication (Boss-directed): Wave 10 broadens the hunt beyond Ramses lineage. Candidate directions:
- Velocimeter / Solidly ecosystem on alt-L1s
- Non-V3 designs (e.g., Liquidity Book on Merchant Moe / Trader Joe)
- Pre-2022 chains with mature DEX ecosystems
- Cross-protocol pairings (e.g., UniV3 vs non-Solidly V2 forks)

Lineage-based search remains in the toolbox but is no longer the primary heuristic.

---

## Files in this archive
- `README.md` — this file (verdict + reasoning + framework contribution)

---

## Cross-references
- Project ledger: [../../project_ledger.md](../../project_ledger.md)
- Research notebook: [../../research/ramses_class_surface_characteristics.md](../../research/ramses_class_surface_characteristics.md)
- Behavioral signature thesis: [../../thesis/behavioral_signature.md](../../thesis/behavioral_signature.md)
- DEX contract discovery lesson: [../../lessons/dex_contract_discovery_pitfalls.md](../../lessons/dex_contract_discovery_pitfalls.md)
- Mantle factory verification: `scripts/research/mantle_factory_verification.js` (wave9 commit 2)
- Mantle pool ABI diagnostic: `scripts/research/mantle_pool_abi_diagnostic.js` (wave9 commit 3)

## Pre-archive commit chain
```
d589332  wave9(commit 1): mantle chain integration (cleopatra-only)
2f45794  fix(wave9): mantle target_pairs file + chains schema alignment + WETH EIP-55
316995e  wave9(commit 2): mantle factory verification diagnostic
1cf936e  fix(wave9): cleopatra_cl uniswap_v3 ABI correction + lesson log
de9c782  wave9(commit 3): mantle pool ABI diagnostic
```
