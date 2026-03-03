#!/usr/bin/env python3
"""
check_contract.py
Reads live contract state and wallet balance from Arbitrum.
Run from ~/Allmight:  python3 check_contract.py
"""
import os, json
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
    print("Installing web3...")
    import subprocess
    subprocess.run(["pip3", "install", "web3", "--break-system-packages", "-q"])
    from web3 import Web3

rpc      = os.environ.get('ARBITRUM_MAINNET_RPC_URL_1', '')
contract = os.environ.get('ARBITRAGE_BOT_ADDRESS', '')
pk       = os.environ.get('METAMASK_PRIVATE_KEY', '')

if not rpc:      print("ERROR: ARBITRUM_MAINNET_RPC_URL_1 not set in .env"); exit(1)
if not contract: print("ERROR: ARBITRAGE_BOT_ADDRESS not set in .env"); exit(1)
if not pk:       print("ERROR: METAMASK_PRIVATE_KEY not set in .env"); exit(1)

w3      = Web3(Web3.HTTPProvider(rpc))
wallet  = w3.eth.account.from_key(pk).address

abi = [
    {'inputs':[],'name':'slippageBps',  'outputs':[{'type':'uint256'}],'stateMutability':'view','type':'function'},
    {'inputs':[],'name':'minProfitUsd', 'outputs':[{'type':'uint256'}],'stateMutability':'view','type':'function'},
    {'inputs':[],'name':'owner',        'outputs':[{'type':'address'}],'stateMutability':'view','type':'function'},
]

c = w3.eth.contract(address=Web3.to_checksum_address(contract), abi=abi)

print()
print("=" * 52)
print("  CONTRACT + WALLET STATE  (Arbitrum)")
print("=" * 52)
print(f"  Connected:       {w3.is_connected()}")
print(f"  Contract:        {contract}")
print(f"  Owner:           {c.functions.owner().call()}")
print()

slip = c.functions.slippageBps().call()
minp = c.functions.minProfitUsd().call()
bal  = w3.from_wei(w3.eth.get_balance(wallet), 'ether')
eth_price = 2700  # rough estimate for USD display

print(f"  slippageBps:     {slip}  ({slip/100:.2f}% max slippage)")
print(f"  minProfitUsd:    {minp} raw  (${minp/1e6:.4f} USDT, 6-dec)")
print()
print(f"  Wallet:          {wallet}")
print(f"  Wallet ETH:      {float(bal):.6f} ETH  (~${float(bal)*eth_price:.2f})")
print()

# Contract USDT balance (if any)
usdt_abi = [{'inputs':[{'type':'address'}],'name':'balanceOf','outputs':[{'type':'uint256'}],'stateMutability':'view','type':'function'}]
usdt_addr = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"  # USDT on Arbitrum
try:
    usdt = w3.eth.contract(address=Web3.to_checksum_address(usdt_addr), abi=usdt_abi)
    contract_usdt = usdt.functions.balanceOf(Web3.to_checksum_address(contract)).call() / 1e6
    wallet_usdt   = usdt.functions.balanceOf(Web3.to_checksum_address(wallet)).call() / 1e6
    print(f"  Contract USDT:   ${contract_usdt:.4f}")
    print(f"  Wallet USDT:     ${wallet_usdt:.4f}")
except Exception as e:
    print(f"  USDT balance:    could not fetch ({e})")

print()

# Diagnosis
print("=" * 52)
print("  DIAGNOSIS")
print("=" * 52)
if slip > 30:
    print(f"  ⚠️  slippageBps={slip} is WIDER than most edges.")
    print(f"      Trades with <{slip}bps edge will likely revert.")
    print(f"      Recommend: setSlippageBps(20) via contract owner call.")
else:
    print(f"  ✅ slippageBps={slip} looks reasonable.")

if minp == 0:
    print(f"  ⚠️  minProfitUsd=0 -- no on-chain profit floor set.")
elif minp <= 10000:
    print(f"  ✅ minProfitUsd=${minp/1e6:.4f} -- gate is open.")
else:
    print(f"  ⚠️  minProfitUsd=${minp/1e6:.4f} -- gate may be too high.")

if float(bal) < 0.01:
    print(f"  ❌ Wallet ETH LOW: {float(bal):.6f} ETH -- may not cover gas.")
else:
    print(f"  ✅ Wallet ETH sufficient for gas.")

print("=" * 52)
print()
