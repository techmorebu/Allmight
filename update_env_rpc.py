#!/usr/bin/env python3
"""
Updates .env with all verified Infura endpoints.
Only adds entries that don't already exist.
Prioritizes chains relevant to arbitrage.

Run: python3 update_env_rpc.py
"""
import os, re

ENV_PATH = os.path.expanduser("~/Allmight/.env")
KEY = "8e7234907efc4e92a78de29f031c55da"

# All confirmed Infura endpoints for this key
# Ordered by arbitrage relevance
NEW_ENTRIES = {
    # ── Active chains (arb-relevant) ─────────────────────────────────────────
    "BASE_MAINNET_RPC_URL_1":       f"https://base-mainnet.infura.io/v3/{KEY}",
    "OPTIMISM_MAINNET_RPC_URL_1":   f"https://optimism-mainnet.infura.io/v3/{KEY}",
    "POLYGON_MAINNET_RPC_URL_1":    f"https://polygon-mainnet.infura.io/v3/{KEY}",
    "BSC_MAINNET_RPC_URL_1":        f"https://bsc-mainnet.infura.io/v3/{KEY}",
    "AVALANCHE_MAINNET_RPC_URL_1":  f"https://avalanche-mainnet.infura.io/v3/{KEY}",
    "ZKSYNC_MAINNET_RPC_URL_1":     f"https://zksync-mainnet.infura.io/v3/{KEY}",
    "LINEA_MAINNET_RPC_URL_1":      f"https://linea-mainnet.infura.io/v3/{KEY}",
    "SCROLL_MAINNET_RPC_URL_1":     f"https://scroll-mainnet.infura.io/v3/{KEY}",
    "BLAST_MAINNET_RPC_URL_1":      f"https://blast-mainnet.infura.io/v3/{KEY}",
    "UNICHAIN_MAINNET_RPC_URL_1":   f"https://unichain-mainnet.infura.io/v3/{KEY}",
    # ── Testnets ──────────────────────────────────────────────────────────────
    "ARBITRUM_SEPOLIA_RPC_URL_1":   f"https://arbitrum-sepolia.infura.io/v3/{KEY}",
    "ETHEREUM_SEPOLIA_RPC_URL_1":   f"https://sepolia.infura.io/v3/{KEY}",
    # ── Chain IDs ─────────────────────────────────────────────────────────────
    "OPTIMISM_CHAIN_ID":            "10",
    "POLYGON_CHAIN_ID":             "137",
    "BSC_CHAIN_ID":                 "56",
    "AVALANCHE_CHAIN_ID":           "43114",
    "ZKSYNC_CHAIN_ID":              "324",
    "LINEA_CHAIN_ID":               "59144",
    "SCROLL_CHAIN_ID":              "534352",
    "BLAST_CHAIN_ID":               "81457",
    "UNICHAIN_CHAIN_ID":            "1301",
    # ── Block explorers ───────────────────────────────────────────────────────
    "OPTIMISM_BLOCK_EXPLORER":      "https://optimistic.etherscan.io",
    "POLYGON_BLOCK_EXPLORER":       "https://polygonscan.com",
    "BSC_BLOCK_EXPLORER":           "https://bscscan.com",
    "AVALANCHE_BLOCK_EXPLORER":     "https://snowtrace.io",
    "ZKSYNC_BLOCK_EXPLORER":        "https://explorer.zksync.io",
    "LINEA_BLOCK_EXPLORER":         "https://lineascan.build",
    "SCROLL_BLOCK_EXPLORER":        "https://scrollscan.com",
    "BLAST_BLOCK_EXPLORER":         "https://blastscan.io",
}

# Read existing .env
with open(ENV_PATH) as f:
    existing = f.read()

# Find keys already in .env
existing_keys = set(re.findall(r'^([A-Z0-9_]+)=', existing, re.MULTILINE))

# Build new entries to append
to_add = {}
to_update = {}
for key, val in NEW_ENTRIES.items():
    if key not in existing_keys:
        to_add[key] = val
    else:
        # Check if value needs updating (e.g. old public RPC -> Infura)
        current_match = re.search(rf'^{key}=(.+)$', existing, re.MULTILINE)
        if current_match:
            current_val = current_match.group(1).strip()
            if 'infura.io' in val and 'infura.io' not in current_val:
                to_update[key] = (current_val, val)

# Apply updates (replace old public RPCs with Infura)
for key, (old_val, new_val) in to_update.items():
    existing = re.sub(
        rf'^{key}=.+$',
        f'{key}={new_val}',
        existing,
        flags=re.MULTILINE
    )
    print(f"UPDATED {key}:")
    print(f"  OLD: {old_val}")
    print(f"  NEW: {new_val}")

with open(ENV_PATH, 'w') as f:
    f.write(existing)

# Append new entries
if to_add:
    with open(ENV_PATH, 'a') as f:
        f.write("\n# ── Additional Infura RPC Endpoints ─────────────────────────────────────\n")
        for key, val in to_add.items():
            f.write(f"{key}={val}\n")
    print(f"\nAdded {len(to_add)} new entries:")
    for key, val in to_add.items():
        print(f"  {key}={val}")
else:
    print("No new entries to add")

if not to_update and not to_add:
    print("All entries already current")

print(f"\nTotal updates: {len(to_update)}  New additions: {len(to_add)}")
print("\nVerify Base:")
print("  set -a && source .env && set +a")
print("  python3 scripts/tools/rpc_healthcheck.py --prefix BASE_MAINNET --expected-chain-id 8453")
