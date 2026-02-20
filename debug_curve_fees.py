#!/usr/bin/env python3
"""
Debugs raw Curve fee values and fixes the fee calculation in curveFetcherArbitrum.js

Run: python3 debug_curve_fees.py
"""
import os, sys, subprocess, json

# Check raw Redis data first
sys.path.insert(0, os.path.expanduser("~/Allmight"))
import redis
r = redis.from_url("redis://127.0.0.1:6379")

raw = r.get("fetcher:curveFetcherArbitrum")
if raw:
    data = json.loads(raw)
    prices = data.get("data", {}).get("data", {}).get("prices", [])
    print("Raw Curve data from Redis:")
    for p in prices:
        print(f"  pair={p['pair']} fee={p.get('fee')} fee_bps={p.get('fee_bps')} price={p['price']:.6f}")
else:
    print("No curveFetcherArbitrum data in Redis")

# Now check raw fee value from chain
NODE_SCRIPT = """
require('dotenv').config();
const { ethers } = require('ethers');
const p = new ethers.JsonRpcProvider(process.env.ARBITRUM_MAINNET_RPC_URL_1);
const ABI = ['function fee() external view returns (uint256)'];
const pools = [
    {name: '2pool USDC/USDT', addr: '0x7f90122BF0700F9E7e1F688fe926940E8839F353'},
    {name: 'tricrypto',       addr: '0x960ea3e3C7FB317332d990873d354E18d7645590'},
];
Promise.all(pools.map(async pool => {
    const c = new ethers.Contract(pool.addr, ABI, p);
    const fee = await c.fee();
    const raw = Number(fee);
    console.log(`${pool.name}: fee_raw=${raw} -> as_pct=${raw/1e10*100}% -> as_bps=${raw/1e10*10000}bps`);
})).catch(console.error);
"""

script_path = os.path.expanduser("~/Allmight/debug_curve_fee.js")
with open(script_path, "w") as f:
    f.write(NODE_SCRIPT)

print("\nRaw fee values from chain:")
result = subprocess.run(
    ["node", "debug_curve_fee.js"],
    cwd=os.path.expanduser("~/Allmight"),
    capture_output=True, text=True, timeout=30
)
print(result.stdout)
if result.stderr:
    print("ERR:", result.stderr[:200])
os.remove(script_path)

# Fix the fee calculation in curveFetcherArbitrum.js
TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/curveFetcherArbitrum.js"
)
with open(TARGET) as f:
    content = f.read()

# Current (wrong):
# fee_bps_val = fee_pct * 100  where fee_pct = Number(fee)/1e10*100
# This double-multiplies by 100
# Correct: fee_bps = Number(fee) / 1e10 * 10000  (direct to bps)

OLD1 = "        const fee_pct     = Number(fee) / 1e10 * 100;  // percent\n        const fee_bps_val = fee_pct * 100;              // basis points"
NEW1 = "        const fee_bps_val = Number(fee) / 1e10 * 10000;  // basis points direct"

OLD2 = "        const fee_bps_val = Number(fee) / 1e10 * 10000;"
NEW2 = "        const fee_bps_val = Number(fee) / 1e10 * 10000;"

fixed = 0
if OLD1 in content:
    content = content.replace(OLD1, NEW1)
    fixed += 1
    print(f"\nFixed fee formula in 2pool section")

if fixed > 0:
    with open(TARGET, "w") as f:
        f.write(content)
    print(f"Written: {TARGET}")
    print("Re-run: node scripts/data_collection/masterFetcher/curveFetcherArbitrum.js")
else:
    print("\nCould not find fee formula -- showing relevant lines:")
    for i, line in enumerate(content.split('\n'), 1):
        if 'fee' in line.lower() and ('1e10' in line or 'bps' in line or 'pct' in line):
            print(f"  {i}: {line}")
