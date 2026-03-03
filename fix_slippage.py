#!/usr/bin/env python3
"""
fix_slippage.py
Updates slippageBps on the deployed ArbitrageBot contract from 50 -> 20.
Run from ~/Allmight:  python3 fix_slippage.py

Use --dry-run to simulate without sending a transaction.
"""
import os, sys
from pathlib import Path

# Load .env
for line in Path('.env').read_text().splitlines():
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, _, v = line.partition('=')
        os.environ[k.strip()] = v.strip()

try:
    from web3 import Web3
except ImportError:
    import subprocess
    subprocess.run(["pip3", "install", "web3", "--break-system-packages", "-q"])
    from web3 import Web3

DRY_RUN  = "--dry-run" in sys.argv
NEW_SLIP = 20   # 0.20%

rpc      = os.environ.get('ARBITRUM_MAINNET_RPC_URL_1', '')
contract = os.environ.get('ARBITRAGE_BOT_ADDRESS', '')
pk       = os.environ.get('METAMASK_PRIVATE_KEY', '')

w3     = Web3(Web3.HTTPProvider(rpc))
wallet = w3.eth.account.from_key(pk).address

abi = [
    {'inputs':[],'name':'slippageBps',
     'outputs':[{'type':'uint256'}],'stateMutability':'view','type':'function'},
    {'inputs':[{'name':'newBps','type':'uint256'}],'name':'setSlippageBps',
     'outputs':[],'stateMutability':'nonpayable','type':'function'},
    {'inputs':[],'name':'owner',
     'outputs':[{'type':'address'}],'stateMutability':'view','type':'function'},
]

c       = w3.eth.contract(address=Web3.to_checksum_address(contract), abi=abi)
current = c.functions.slippageBps().call()
owner   = c.functions.owner().call()

print()
print("=" * 52)
print("  fix_slippage.py")
print("=" * 52)
print(f"  Contract:  {contract}")
print(f"  Owner:     {owner}")
print(f"  Wallet:    {wallet}")
print(f"  Current slippageBps: {current} ({current/100:.2f}%)")
print(f"  Target  slippageBps: {NEW_SLIP} ({NEW_SLIP/100:.2f}%)")
print(f"  Mode:      {'DRY RUN' if DRY_RUN else 'LIVE -- will send tx'}")
print("=" * 52)

if owner.lower() != wallet.lower():
    print(f"\n  ERROR: wallet is not contract owner.")
    sys.exit(1)

if current == NEW_SLIP:
    print(f"\n  Already set to {NEW_SLIP}bps -- nothing to do.")
    sys.exit(0)

if DRY_RUN:
    print(f"\n  DRY RUN: would call setSlippageBps({NEW_SLIP})")
    sys.exit(0)

# EIP-1559 gas pricing with 20% buffer over base fee
print(f"\n  Sending setSlippageBps({NEW_SLIP})...")
latest       = w3.eth.get_block('latest')
base_fee     = latest['baseFeePerGas']
max_priority = w3.to_wei(0.1, 'gwei')
max_fee      = int(base_fee * 1.2) + max_priority

print(f"  base_fee:  {w3.from_wei(base_fee, 'gwei'):.4f} gwei")
print(f"  max_fee:   {w3.from_wei(max_fee, 'gwei'):.4f} gwei")

tx = c.functions.setSlippageBps(NEW_SLIP).build_transaction({
    'from':                 wallet,
    'nonce':                w3.eth.get_transaction_count(wallet),
    'gas':                  100_000,
    'maxFeePerGas':         max_fee,
    'maxPriorityFeePerGas': max_priority,
    'type':                 2,
})

signed  = w3.eth.account.sign_transaction(tx, pk)
tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
print(f"  Tx submitted: {tx_hash.hex()}")
print(f"  Waiting for confirmation...")

receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
status  = "SUCCESS" if receipt.status == 1 else "FAILED"
print(f"  {status}  block={receipt.blockNumber}  gas={receipt.gasUsed}")

if receipt.status == 1:
    new_val = c.functions.slippageBps().call()
    print(f"\n  Confirmed slippageBps: {new_val} ({new_val/100:.2f}%)")
    print(f"  Arbiscan: https://arbiscan.io/tx/{tx_hash.hex()}")
else:
    print(f"\n  https://arbiscan.io/tx/{tx_hash.hex()}")
print()
