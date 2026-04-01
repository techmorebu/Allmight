# ARB/USDC Pool Watchlist
<!-- STATUS: CURRENT | Last updated: 2026-03-28 -->
<!-- Owner: CPT | Authority: Boss ruling 2026-03-28 -->

## Purpose
Pools confirmed to exist and be valid (direct ARB/native-USDC) but NOT yet
admitted to `arbitrumFetcher.js`. Monitored here until Boss rules them
ready for promotion.

Promotion requires ALL of:
- active-tick depth (L×sqrtP) > $10k at time of check
- fee tier compatible with positive net spread vs Camelot V3 counterleg
- confirmed across 3+ checks on different blocks
- Boss ruling before fetcher admission

---

## WATCHLIST ENTRY: UniV3 ARB/USDC 0.01%

| Field | Value |
|---|---|
| Pool address | `0x616a2a065bFE53DA48e83E7d709fB428AA3C9F5B` |
| Venue | UniSwap V3 (Arbitrum) |
| Pair | ARB / native USDC |
| token0 | `0x912CE59144191C1204E64559FE8253a0e49E6548` (ARB) |
| token1 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (native USDC) |
| Fee tier | 100 (0.01%) |
| USDC variant | ✅ native USDC — NOT USDCe |
| tokenMatch | `direct_native_usdc` |
| liquidityRaw | `69399172332439` (non-zero — LP positions exist) |
| Fee burden (vs Camelot 0.0249%) | 0.0349% total — **excellent** |

### Current active-tick depth assessment

| Check date | Block | Active-tick depth (L×sqrtP) | Status |
|---|---|---|---|
| 2026-03-28 | 446482210 | **~$42** | below $7k arm floor |

### Why not admitted yet

Raw `liquidityRaw` is non-zero, meaning LP positions have been deployed.
However, active-tick depth (`L×sqrtP` at the CURRENT tick) is only ~$42.
This means LP positions are concentrated at price ranges away from where
ARB is currently trading (~$0.090).

This is not a dead pool. It is a pool where liquidity is positioned
out-of-range at today's price.

### Promotion watch condition

Admit to fetcher when:
```
active-tick depth (L×sqrtP) ≥ $10,000 on 3+ consecutive checks
AND net spread vs Camelot V3 remains > 0
AND Boss rules admission
```

### Boss ruling (2026-03-28)
> "Watchlist only. Only promote if repeated checks show active-tick depth
>  migrating into relevance. Good fee, wrong location for now."

---

## REJECTED (not watchlisted)

| Pool | Fee | Reason |
|---|---|---|
| `0xaEBDcA1Bc8d89177EbE2308d62af5e74885DcCc3` | 0.30% | fee_blocked — 0.3249% burden > spread |
| `0xAC9a19E85A49BACc28Bd2DeeCab3cdfADBFc3e00` | 1.00% | fee_blocked — 1.0249% burden > spread |

---

## VENUE EXPANSION — FROZEN (Boss ruling 2026-03-28)

Discovery pass complete. No venue beat UniV3 0.05% on confirmed live usability.
Venue expansion frozen until one of:
- ARB/USDC 0.05% depth materially improves (reduces urgency)
- A reputable source provides a **known live pool address** for Sushi or Ramses ARB/USDC
- A new venue identified from pool-first trace, not factory-first speculation

### SushiSwap V3 (Arbitrum) — `skip_venue_unresolved` PARKED
- Factory: `0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e` (4 total txns on Arbiscan)
- All 4 fee-tier `getPool()` probes failed identically. Current classification: `skip_venue_unresolved`.
- Not confirmed dead. Not confirmed usable. Requires known pool address to proceed.
- **Do not resume factory-first research until a live pool address is available.**

### Ramses V2 CL (Arbitrum) — `skip_venue_unresolved` PARKED
- Factory: `0xa67f82621540017a679153423CA0B8a1b4518B49` (confirmed IRamsesV2Factory source)
- All 4 standard fee tier calls fail — hypothesis: Ramses may use non-standard fee tiers or a deployment pattern not covered by the current probe set
- Hypothesis: fee tier 100 reverts; 500/3000/10000 may return zero pool (no ARB/USDC CL pool)
- **Do not resume until known live ARB/USDC Ramses CL pool address obtained from reputable source.**

---

## How to re-check a watchlisted pool

```bash
# Quick active-tick depth check (no fetcher admission, read-only)
node -r dotenv/config -e "
const { ethers } = require('ethers');
const { createProvider } = require('./utils/provider_factory');
const rpc = createProvider('arbitrum');
const POOL = '0x616a2a065bFE53DA48e83E7d709fB428AA3C9F5B';
const ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() view returns (uint128)',
];
(async () => {
  const { blockNumber } = await rpc.getBlockNumber('watch.block', { timeoutMs: 2000 });
  const { result } = await rpc.callDetailed('watch.pool', async (p) => {
    const c = new ethers.Contract(POOL, ABI, p);
    const [s0, liq] = await Promise.all([c.slot0({ blockTag: blockNumber }), c.liquidity({ blockTag: blockNumber })]);
    return { s0, liq };
  }, { timeoutMs: 3000 });
  const sqrtP = Number(result.s0[0]) / (2 ** 96);
  const L = Number(result.liq);
  const depth = (L * sqrtP / 1e6) * 2;  // dec1=6 for USDC
  console.log('block:', blockNumber, '| L:', result.liq.toString(), '| depth: \$' + depth.toFixed(0));
})();
"
```
