# SolidLizard — Arbitrum — Tier 1 Catalog (V4.1)

**Verdict:** Tier 1 — Catalog Only (per [Discovery Constitution V4.1](../../specs/DISCOVERY_CONSTITUTION_V4_1.md), RULE 1)
**Confidence:** HIGH (public-metric pre-screen, no on-chain measurement required at Tier 1)
**Boss ruling:** C9 2026-06-05
**Wave:** W10A (intra-Arbitrum Solidly V2 hypothesis test, second comparator)
**Investigation status:** NO INTEGRATION · NO DISCOVERY · NO PROBE

---

## Why Tier 1 catalog, not full investigation

Per V4.1 RULE 1, surfaces with estimated depth in the $1,000-$100,000
range receive catalog-only treatment. SolidLizard's public metrics
place it squarely in Tier 1:

| Metric | Value | Source |
|--------|------:|--------|
| Total protocol TVL | ~$35,100 | DefiLlama |
| Annualized fees | $12 | DefiLlama |
| 24h volume | negligible | DefiLlama |
| Launch | January 2023 | Official docs |

Under V4.1, no integration commit, no factory verification cycle, and
no discovery sweep is justified for this surface. The catalog entry
preserves SolidLizard's intelligence value for future Class G
(Liquidity Migration) and Class H (Directional/Scalping Research)
investigation without spending operator effort on a pre-screen-
rejected Class A candidate.

**This is the first surface processed start-to-finish under V4.1.**
Before V4.1, this surface would have followed the same integration
sequence as Chronos: factory verification → ABI dance → chains.json
edit → discovery sweep → archive. V4.1 saves that work. The
hypothesis-test value of SolidLizard (a second non-Ramses Arbitrum
Solidly V2 fork) is preserved through this catalog entry.

---

## Surface (catalogued from public sources, NOT verified on-chain)

- **Chain:** Arbitrum (chainId 42161) — same chain as the proven Ramses winner
- **Architecture:** ve(3,3) Solidly fork
- **Launch:** January 2023 (predates native USDC on Arbitrum by ~5 months)
- **Team:** anonymous, "multicultural team based in central Europe and Asia" (per official docs)

### Contract addresses (from official SolidLizard docs)

| Contract | Address |
|----------|---------|
| Factory | `0x734d84631f00dC0d3FCD18b04b6cf42BFd407074` |
| Router | `0xF26515D5482e2C2FD237149bF6A653dA4794b3D0` |
| Token (SLIZ) | `0x463913D3a3D3D291667D53B8325c598Eb88D3B0e` |
| Treasury | `0x1b94Ca0d99a7CD14E67c9D3618A9726094c13360` |
| Controller | `0x23C7170FD3fEc8ef421EBA8F69b8E72Dd86Ac713` |
| Multicall | `0xCeD0b5959209fd6215C6668EEabC05093aa73815` |

**Source:** https://solidlizard.gitbook.io/solidlizard/security/contracts
**Verified on-chain:** No (per V4.1 Tier 1 catalog-only policy)

### Likely architecture characteristics (priors, NOT verified)

Per V4.1 RULE 4 (Lineage Is A Prior), these are recorded as priors
based on Solidly V2 protocol family — they are NOT empirically
verified:

- Factory ABI: likely `getPair(address, address, bool stable)` (Solidly-legacy)
- Pool structure: likely dual stable + volatile curves per pair
- Canonical USD pair: likely WETH/USDC.e (predates native USDC; same era as Chronos)

These priors are recorded for future reference IF SolidLizard ever
graduates to Tier 2+ via meaningful TVL growth (would require ~3×
current TVL to cross $100K threshold).

---

## Why Cross-DEX Arbitrage (Class A) is closed

SolidLizard's $35,100 total TVL spread across all pairs implies
per-pair depth far below the executable threshold. Even in the
theoretical best case where 100% of TVL concentrated in a single
canonical pair:

| Surface | Total TVL | Best canonical-pair depth | Class A status |
|---------|----------:|--------------------------:|----------------|
| Arbitrum Ramses V2 (proven winner) | very large | ~$7,000,000 | EXECUTION_READY |
| Chronos V1 (Wave 10A first comparator) | ~$78,600 | $9,300 (measured) | STRUCTURALLY_DEAD |
| **SolidLizard (this surface)** | **~$35,100** | **not measured (Tier 1)** | **Tier 1 — catalog only** |
| Mantle Cleopatra Legacy | dust | $804 | STRUCTURALLY_DEAD |
| Unichain Velodrome V2 | dust | $88 | STRUCTURALLY_DEAD |
| Sonic Shadow V2 | dust | $79 | STRUCTURALLY_DEAD |

SolidLizard total TVL is **~199× smaller** than the Ramses-class
execution threshold ($7M) and **~2.2× smaller** than Chronos's total
TVL (Chronos itself failed the depth gate at $9,300 on its
canonical pair). For Class A, no further investigation is justified.

---

## Opportunity-class tags (per V4.1 RULE 2)

Every surface must carry opportunity-class tags so future research
phases can locate eligible candidates by class rather than chain.

| Class | Status | Reasoning |
|-------|--------|-----------|
| A. Cross-DEX Arbitrage | ❌ Closed | Total TVL ~199× below execution threshold; even peak depth (if all TVL in one pair) fails Gate A |
| B. Flash Loan Arbitrage | ❌ Closed | No meaningful borrow/execution route at this depth |
| C. Triangular Arbitrage | ❌ Closed | Insufficient pair coverage; depth fails across all legs |
| D. Stablecoin Basis | ❌ Closed | No meaningful stablecoin depth ($35K total ÷ several stable pairs = trivial per-pair) |
| E. LSD Arbitrage | ❌ Closed | No LSD pairs in protocol |
| F. Inventory Arbitrage | ❌ Closed | No persistent flow at $12 annualized fees |
| G. Liquidity Migration | ✅ **OPEN** | "Failed-to-launch" data point valuable for protocol-decay pattern study; complements Chronos's "failed-to-retain" data point |
| H. Directional / Scalping Research | ⚠ Limited | Contributes to "Ramses-class uniqueness" pattern but not a primary research candidate |

**Active opportunity classes:** G (Liquidity Migration — historical
pattern study), H (limited, as supporting evidence).

---

## Comparison to Chronos (the Wave 10A intra-Arbitrum hypothesis test)

The Wave 10A objective was to test "Is Ramses unique INSIDE Arbitrum's
own Solidly V2 ecosystem?" SolidLizard provides the SECOND data point,
catalogued under V4.1:

| Surface | TVL | Best canonical-pair depth | Failure mode | Confounders |
|---------|----:|--------------------------:|--------------|-------------|
| Ramses V2 (winner) | very large | ~$7M | — | — |
| Chronos V1 | ~$78,600 | $9,300 (measured) | "Failed to retain" | USDC.e migration |
| **SolidLizard** | **~$35,100** | **not measured (Tier 1)** | **"Failed to launch"** | None |

The two non-Ramses Arbitrum Solidly V2 forks show two distinct
failure modes:

- **Chronos:** attracted $230M at peak (April 2023), then collapsed
  99.97% to ~$78.6K. **Failed-to-retain** story. Partially confounded
  by USDC.e → native USDC migration in June 2023.

- **SolidLizard:** never reached peak; ~$35K TVL since launch
  (January 2023, three months before Chronos). **Failed-to-launch**
  story. **No USDC.e migration confounder** (SolidLizard never had
  meaningful USDC.e depth to migrate from in the first place).

Per Boss directive 2026-06-05, SolidLizard provides the cleaner
intra-Arbitrum data point precisely because there's no migration
confounder. Both failure modes — "failed to retain" and "failed to
launch" — converge on the same conclusion:

> Same chain. Same architecture. Same era. Different team.
> Different (failed) outcome.

This is strong evidence for "Ramses is specifically unique on Arbitrum"
that does not depend on chain-level variables, architecture-level
variables, or era-level variables. Whatever made Ramses work on
Arbitrum was Ramses-specific (team execution, tokenomics, GMX/Camelot
ecosystem positioning, vote-direction governance, or some combination).

---

## Project state contribution

Surface count: **n = 11 → n = 13** at Wave 10A close-out (Chronos +
SolidLizard added)

Pattern formalization (to be locked in at Wave 10A close-out commit):

- **Pattern 5** (Ramses V2 outside Arbitrum doesn't replicate):
  HIGH confidence, n=3 chain-external (Sonic, Unichain, Mantle).
- **Pattern 6** (Ramses unique INSIDE Arbitrum's Solidly V2 ecosystem):
  emerging, n=2 intra-chain (Chronos measured + SolidLizard
  catalog-screened). Combined with Pattern 5, supports the broader
  claim that Ramses-on-Arbitrum is a singular phenomenon, not a
  reproducible architectural outcome.

Stable-curve cross-wave observation now n=4 (formalized at close-out):

- Sonic Shadow V2 wS/USDC stable
- Mantle Cleopatra Legacy WMNT/USDC stable
- Mantle Cleopatra CL WMNT/USDC fee=100 (active pool, zero depth)
- Chronos WETH/USDC.e stable ($106, anomalous $4,757 quote)

---

## Files in this archive

- `README.md` — this file (Tier 1 catalog entry with opportunity-class tags)

No discovery output. No factory verification log. No probe data. None
of these artifacts exist for Tier 1 surfaces by V4.1 policy.

---

## Cross-references

- Discovery Constitution V4.1: [../../specs/DISCOVERY_CONSTITUTION_V4_1.md](../../specs/DISCOVERY_CONSTITUTION_V4_1.md)
- Project ledger: [../../project_ledger.md](../../project_ledger.md)
- Research notebook: [../../research/ramses_class_surface_characteristics.md](../../research/ramses_class_surface_characteristics.md)
- Behavioral signature thesis: [../../thesis/behavioral_signature.md](../../thesis/behavioral_signature.md)
- Wave 10A Chronos archive (the empirically-measured intra-Arbitrum comparator): [../chronos_v1_arbitrum/README.md](../chronos_v1_arbitrum/README.md)

## Pre-catalog commit chain
```
111fcc4  wave10a(commit 1): chronos_v1 venue + WETH/USDC.e pair (arbitrum)
95e0517  wave10a(commit 2): archive chronos_v1 (STRUCTURALLY_DEAD)
1ad113d  constitution: lock in Discovery Constitution V4.1
```
