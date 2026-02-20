#!/usr/bin/env python3
"""
Fixes fetchCamelotPool in arbitrumFetcher.js.
Uses brace-counting to find and replace the function precisely.
Run: python3 fix_camelot.py
"""
import os

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/arbitrumFetcher.js"
)

NEW_FUNC = """\
async function fetchCamelotPool(cfg) {
    try {
        const c   = new ethers.Contract(cfg.pool, PAIR_ABI_V2, PROVIDER);
        const res = await c.getReserves();

        // res[0] and res[1] are native bigint primitives in ethers v6
        // Use BigInt arithmetic to avoid Number overflow on large reserves
        const r0b = res[0];
        const r1b = res[1];
        if (r0b === 0n || r1b === 0n) return null;

        // Divide by token decimals using BigInt, then scale to float
        // PREC=1e9 gives 9 decimal places of precision
        const PREC   = 1000000000n;
        const SCALE0 = BigInt('1' + '0'.repeat(cfg.decimals0));
        const SCALE1 = BigInt('1' + '0'.repeat(cfg.decimals1));

        const adj0 = Number(r0b * PREC / SCALE0) / 1e9;
        const adj1 = Number(r1b * PREC / SCALE1) / 1e9;

        if (adj0 === 0 || adj1 === 0) return null;

        // raw = token1 per token0 (both already decimal-adjusted)
        const raw   = adj1 / adj0;
        const price = cfg.priceMode === 'invert' ? 1.0 / raw : raw;

        if (!isFinite(price) || price <= 0 || price > 1e12) return null;

        const tvlUSD = cfg.outputPair === 'ETH/USDC'
            ? adj0 * 2          // USDC.e side x2
            : adj1 * price * 2;

        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool,
            price,
            reserve0:   r0b.toString(),
            reserve1:   r1b.toString(),
            reserveUSD: tvlUSD,
            fee:        cfg.fee,
            source:     'camelot_v2_arbitrum_onchain',
            venue:      'camelot_v2',
            chain:      CHAIN_ID,
            timestamp:  new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[ARB] Camelot ${cfg.outputPair}: ${e.message.slice(0, 100)}`);
        return null;
    }
}
"""

with open(TARGET) as f:
    lines = f.readlines()

# Find fetchCamelotPool by brace counting
start = end = None
depth = 0
for i, line in enumerate(lines):
    if 'async function fetchCamelotPool' in line:
        start = i
        depth = 0
    if start is not None:
        depth += line.count('{') - line.count('}')
        if depth == 0 and i > start:
            end = i
            break

if start is None or end is None:
    print(f"ERROR: Could not locate fetchCamelotPool (start={start} end={end})")
    exit(1)

print(f"Found fetchCamelotPool at lines {start+1}–{end+1}")

new_lines = lines[:start] + [NEW_FUNC + '\n'] + lines[end+1:]

with open(TARGET, 'w') as f:
    f.writelines(new_lines)

print(f"✅ Replaced fetchCamelotPool in {TARGET}")
print("   Run: node scripts/data_collection/masterFetcher/arbitrumFetcher.js")
