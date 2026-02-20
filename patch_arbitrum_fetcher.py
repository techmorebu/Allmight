#!/usr/bin/env python3
"""
Patch: fixes two bugs in arbitrumFetcher.js
  1. ARB/ETH price inverted (was showing ETH/ARB = ~19909, should be ~0.00018)
  2. Camelot V2 reserve overflow (BigInt -> Number overflow on large reserves)

Run: python3 patch_arbitrum_fetcher.py
"""
import os, re

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/arbitrumFetcher.js"
)

with open(TARGET, 'r') as f:
    content = f.read()

# ── Fix 1: ARB/ETH priceMode direct → invert ─────────────────────────────────
# sqrtP^2 for ARB/ETH pool gives ETH-per-ARB (very small number ~0.00018)
# which IS correct for outputPair 'ARB/ETH' meaning "price of ARB in ETH"
# But the pool returned ~19909 meaning it's actually ETH/ARB ratio
# Need to invert to get ARB price in ETH terms
OLD1 = """    {
        outputPair: 'ARB/ETH',
        pool:       '0xC6F780497A95e246EB9449f5e4770916DCd6396A',
        decimals0:  18,   // ARB
        decimals1:  18,   // WETH
        fee:        3000,
        priceMode:  'direct',  // ETH per ARB
    },"""

NEW1 = """    {
        outputPair: 'ARB/ETH',
        pool:       '0xC6F780497A95e246EB9449f5e4770916DCd6396A',
        decimals0:  18,   // ARB (token0)
        decimals1:  18,   // WETH (token1)
        fee:        3000,
        priceMode:  'invert',  // sqrtP^2 = WETH/ARB (~19909) -> invert = ARB/ETH (~0.000050)
    },"""

# ── Fix 2: Camelot reserve overflow ──────────────────────────────────────────
# ethers v6 returns reserves as BigInt. Number(BigInt) overflows for large reserves.
# Solution: divide BigInt first, then convert to Number.
OLD2 = """async function fetchCamelotPool(cfg) {
    try {
        const c   = new ethers.Contract(cfg.pool, PAIR_ABI_V2, PROVIDER);
        const res = await c.getReserves();
        const r0  = Number(res[0]);
        const r1  = Number(res[1]);
        if (!r0 || !r1) return null;

        const adj0  = r0 / Math.pow(10, cfg.decimals0);
        const adj1  = r1 / Math.pow(10, cfg.decimals1);
        const raw   = adj1 / adj0;
        const price = cfg.priceMode === 'invert' ? 1 / raw : raw;
        if (!isFinite(price) || price <= 0) return null;

        const tvlUSD = cfg.outputPair === 'ETH/USDC'
            ? adj0 * 2              // USDC.e side × 2
            : adj1 * price * 2;

        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool,
            price,
            reserve0:   String(res[0]),
            reserve1:   String(res[1]),
            reserveUSD: tvlUSD,
            fee:        cfg.fee,
            source:     'camelot_v2_arbitrum_onchain',
            venue:      'camelot_v2',
            chain:      CHAIN_ID,
            timestamp:  new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[ARB] Camelot ${cfg.outputPair} ${cfg.pool.slice(0,10)}: ${e.message.slice(0,100)}`);
        return null;
    }
}"""

NEW2 = """async function fetchCamelotPool(cfg) {
    try {
        const c   = new ethers.Contract(cfg.pool, PAIR_ABI_V2, PROVIDER);
        const res = await c.getReserves();

        // ethers v6 returns reserves as BigInt — divide before converting to Number
        // to avoid overflow on large reserves (e.g. USDC.e pools)
        const SCALE0 = BigInt(10 ** cfg.decimals0);
        const SCALE1 = BigInt(10 ** cfg.decimals1);
        const PREC   = 1_000_000n; // 6 decimal precision

        const r0BigInt = BigInt(res[0].toString());
        const r1BigInt = BigInt(res[1].toString());

        if (r0BigInt === 0n || r1BigInt === 0n) return null;

        // Scale down by token decimals, keep precision via integer math
        const adj0 = Number(r0BigInt * PREC / SCALE0) / Number(PREC);
        const adj1 = Number(r1BigInt * PREC / SCALE1) / Number(PREC);

        if (adj0 === 0 || adj1 === 0) return null;

        const raw   = adj1 / adj0;
        const price = cfg.priceMode === 'invert' ? 1 / raw : raw;
        if (!isFinite(price) || price <= 0 || price > 1e10) return null;

        const tvlUSD = cfg.outputPair === 'ETH/USDC'
            ? adj0 * 2              // USDC.e side × 2
            : adj1 * price * 2;

        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool,
            price,
            reserve0:   res[0].toString(),
            reserve1:   res[1].toString(),
            reserveUSD: tvlUSD,
            fee:        cfg.fee,
            source:     'camelot_v2_arbitrum_onchain',
            venue:      'camelot_v2',
            chain:      CHAIN_ID,
            timestamp:  new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[ARB] Camelot ${cfg.outputPair} ${cfg.pool.slice(0,10)}: ${e.message.slice(0,100)}`);
        return null;
    }
}"""

fixes = [(OLD1, NEW1, "ARB/ETH priceMode"), (OLD2, NEW2, "Camelot BigInt overflow")]
applied = 0
for old, new, label in fixes:
    if old in content:
        content = content.replace(old, new, 1)
        print(f"✅ Fixed: {label}")
        applied += 1
    else:
        print(f"❌ Could not find: {label} — check manually")

if applied > 0:
    with open(TARGET, 'w') as f:
        f.write(content)
    print(f"\n✅ Wrote {applied}/2 fixes to {TARGET}")
    print("   Run: node scripts/data_collection/masterFetcher/arbitrumFetcher.js")
