#!/usr/bin/env python3
"""
1. Removes dead Base public RPC entries from .env (keeps only Infura)
2. Updates baseFetcher.js to use BASE_MAINNET_RPC_URL_1 (Infura)
3. Reduces fetch delay now that we have a real RPC

Run: python3 cleanup_base_rpc.py
"""
import os, re

ROOT = os.path.expanduser("~/Allmight")
ENV_PATH = os.path.join(ROOT, ".env")

# ── Step 1: Clean dead Base RPC entries from .env ────────────────────────────
DEAD_BASE_RPCS = [
    "BASE_MAINNET_RPC_URL_2=https://base-rpc.publicnode.com",
    "BASE_MAINNET_RPC_URL_3=https://endpoints.omniatech.io/v1/base/mainnet/public",
    "BASE_MAINNET_RPC_URL_4=https://developer-access-mainnet.base.org",
]

with open(ENV_PATH) as f:
    env_lines = f.readlines()

new_env_lines = []
removed = []
for line in env_lines:
    stripped = line.strip()
    if any(stripped == dead for dead in DEAD_BASE_RPCS):
        removed.append(stripped)
    else:
        new_env_lines.append(line)

with open(ENV_PATH, 'w') as f:
    f.writelines(new_env_lines)

print(f"Removed {len(removed)} dead Base RPC entries from .env:")
for r in removed:
    print(f"  {r[:80]}")

# ── Step 2: Update baseFetcher.js to use Infura ──────────────────────────────
TARGET = os.path.join(ROOT, "scripts/data_collection/masterFetcher/baseFetcher.js")

with open(TARGET) as f:
    content = f.read()

# Replace RPC URL line and reduce delay
old_rpc = "const RPC_URL = process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org';"
new_rpc = "const RPC_URL = process.env.BASE_MAINNET_RPC_URL_1 || process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org';"

old_delay = "const FETCH_DELAY_MS = 700;  // public RPC needs more breathing room"
new_delay = "const FETCH_DELAY_MS = 400;  // Infura endpoint -- faster"

changes = 0
if old_rpc in content:
    content = content.replace(old_rpc, new_rpc)
    changes += 1
    print(f"\nUpdated baseFetcher.js RPC URL to use BASE_MAINNET_RPC_URL_1")

if old_delay in content:
    content = content.replace(old_delay, new_delay)
    changes += 1
    print(f"Reduced fetch delay: 700ms -> 400ms")

if changes > 0:
    with open(TARGET, 'w') as f:
        f.write(content)
    print(f"Written: {TARGET}")
else:
    print("\nWarning: patterns not found in baseFetcher.js")
    print("RPC line in file:")
    for i, line in enumerate(content.split('\n'), 1):
        if 'RPC_URL' in line and 'const' in line:
            print(f"  {i}: {line}")

print("\nRun:")
print("  set -a && source .env && set +a")
print("  node scripts/data_collection/masterFetcher/baseFetcher.js")
