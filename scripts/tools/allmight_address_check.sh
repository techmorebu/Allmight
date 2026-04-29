#!/usr/bin/env bash
# allmight_address_check.sh
# PROJECT ALLMIGHT — Pre-fork address verification
# Run from ~/Allmight with .env loaded. Requires cast (Foundry).
# Output is copy-paste ready for Boss report.
#
# Usage:
#   cd ~/Allmight
#   source .env && bash scripts/tools/allmight_address_check.sh
#
# Prerequisites:
#   cast installed (foundryup)
#   ARBITRUM_MAINNET_RPC_URL_1 or _2 in .env

set -euo pipefail

RPC="${ARBITRUM_MAINNET_RPC_URL_2:-${ARBITRUM_MAINNET_RPC_URL_1:?Need ARBITRUM_MAINNET_RPC_URL_1 or _2 in env}}"

WETH="0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
USDC="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
UNIV3_FACTORY="0x1F98431c8aD98523631AE4a59f267346ea31F984"
RAMSES_FACTORY="0xaa2cd7477c451e703f3b9ba5663334914763edf8"
LEGACY_ROUTER="0xAAA87963EFeB6f7E0a2711F397663105Acb1805e"
EXACT_INPUT_SINGLE_SELECTOR="414bf389"   # keccak4(exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160)))

die()  { echo "❌ ERROR: $*" >&2; exit 1; }
ok()   { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

echo "═══════════════════════════════════════════════════════"
echo "  PROJECT ALLMIGHT — ADDRESS VERIFICATION"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  RPC: $(echo "$RPC" | sed 's/\/v3\/.*/\/v3\/[REDACTED]/' | sed 's|https://||' | cut -d'/' -f1)"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────────────────────
# TASK 1: UniswapV3 WETH/USDC 0.01% pool
# ─────────────────────────────────────────────────────────────
echo "── TASK 1: UniV3 WETH/USDC 0.01% (fee=100) pool ──"
UNI_POOL=$(cast call "$UNIV3_FACTORY" \
  'getPool(address,address,uint24)(address)' \
  "$WETH" "$USDC" 100 \
  --rpc-url "$RPC") || die "UniV3 getPool(WETH,USDC,100) call failed"

if [[ "$UNI_POOL" == "0x0000000000000000000000000000000000000000" ]]; then
  warn "UniV3 0.01% pool = ZERO (WETH/USDC order). Trying USDC/WETH..."
  UNI_POOL=$(cast call "$UNIV3_FACTORY" \
    'getPool(address,address,uint24)(address)' \
    "$USDC" "$WETH" 100 \
    --rpc-url "$RPC") || true
  if [[ "$UNI_POOL" == "0x0000000000000000000000000000000000000000" ]]; then
    echo "   ❌ UniV3 0.01% WETH/USDC pool DOES NOT EXIST on this factory"
    UNI_POOL="ZERO"
  else
    ok "UniV3 0.01% pool (USDC/WETH order): $UNI_POOL"
  fi
else
  ok "UniV3 0.01% pool: $UNI_POOL"
fi
echo ""

# ─────────────────────────────────────────────────────────────
# TASK 2: Ramses CL WETH/USDC 0.05% pool
# ─────────────────────────────────────────────────────────────
echo "── TASK 2: Ramses CL WETH/USDC 0.05% (fee=500) pool ──"
RAMSES_POOL=$(cast call "$RAMSES_FACTORY" \
  'getPool(address,address,uint24)(address)' \
  "$WETH" "$USDC" 500 \
  --rpc-url "$RPC") || die "Ramses getPool(WETH,USDC,500) call failed"

if [[ "$RAMSES_POOL" == "0x0000000000000000000000000000000000000000" ]]; then
  warn "Ramses 0.05% pool = ZERO (WETH/USDC order). Trying USDC/WETH..."
  RAMSES_POOL=$(cast call "$RAMSES_FACTORY" \
    'getPool(address,address,uint24)(address)' \
    "$USDC" "$WETH" 500 \
    --rpc-url "$RPC") || true
  if [[ "$RAMSES_POOL" == "0x0000000000000000000000000000000000000000" ]]; then
    echo "   ❌ Ramses 0.05% WETH/USDC pool DOES NOT EXIST — factory may be wrong"
    RAMSES_POOL="ZERO"
  else
    ok "Ramses 0.05% pool (USDC/WETH order): $RAMSES_POOL"
  fi
else
  ok "Ramses 0.05% pool: $RAMSES_POOL"
fi

# Also verify pool's factory() returns the expected factory
if [[ "$RAMSES_POOL" != "ZERO" ]]; then
  POOL_FACTORY=$(cast call "$RAMSES_POOL" 'factory()(address)' --rpc-url "$RPC" 2>/dev/null) || POOL_FACTORY="error"
  echo "   Pool's factory() returns: $POOL_FACTORY"
  if [[ "${POOL_FACTORY,,}" == "${RAMSES_FACTORY,,}" ]]; then
    ok "Pool factory matches RamsesV2Factory — confirmed correct pool"
  else
    warn "Pool factory ($POOL_FACTORY) != expected factory ($RAMSES_FACTORY)"
  fi
fi
echo ""

# ─────────────────────────────────────────────────────────────
# TASK 3: Find Ramses CL SwapRouter via pool Swap events
# Boss rule: tx.to from a swap txn is more reliable than event.sender
# ─────────────────────────────────────────────────────────────
echo "── TASK 3: Ramses CL SwapRouter discovery ──"
RAMSES_ROUTER="UNKNOWN"
TX_HASH_FOUND=""

if [[ "$RAMSES_POOL" != "ZERO" ]]; then
  echo "   Pool: $RAMSES_POOL"
  CURRENT_BLOCK=$(cast block-number --rpc-url "$RPC")
  echo "   Current block: $CURRENT_BLOCK"

  SWAP_SIG="Swap(address,address,int256,int256,uint160,uint128,int24)"

  for LOOKBACK in 200 2000 10000; do
    FROM_BLOCK=$(( CURRENT_BLOCK - LOOKBACK ))
    echo "   Scanning logs from block $FROM_BLOCK (lookback $LOOKBACK)..."
    LOGS=$(cast logs \
      --address "$RAMSES_POOL" \
      --from-block "$FROM_BLOCK" \
      "$SWAP_SIG" \
      --rpc-url "$RPC" 2>/dev/null | head -80) || LOGS=""

    if [[ -n "$LOGS" ]]; then
      TX_HASH_FOUND=$(echo "$LOGS" | grep -m1 'transactionHash' | awk '{print $NF}' | tr -d '",' | tr -d ' ')
      if [[ -n "$TX_HASH_FOUND" && "$TX_HASH_FOUND" != "null" && ${#TX_HASH_FOUND} -eq 66 ]]; then
        ok "Swap event found in last $LOOKBACK blocks"
        echo "   Tx hash: $TX_HASH_FOUND"
        break
      fi
    fi
    echo "   No Swap events in last $LOOKBACK blocks, expanding..."
  done

  if [[ -n "$TX_HASH_FOUND" && ${#TX_HASH_FOUND} -eq 66 ]]; then
    # Get tx.to (Boss-approved method — the user-facing entry contract)
    TX_TO=$(cast tx "$TX_HASH_FOUND" to --rpc-url "$RPC" 2>/dev/null | tr -d ' ') || TX_TO=""
    TX_FROM=$(cast tx "$TX_HASH_FOUND" from --rpc-url "$RPC" 2>/dev/null | tr -d ' ') || TX_FROM=""

    echo "   tx.from: $TX_FROM"
    echo "   tx.to:   $TX_TO  ← Boss-approved router candidate"

    if [[ -n "$TX_TO" ]]; then
      RAMSES_ROUTER="$TX_TO"
    fi
  else
    echo "   ❌ No Swap transaction hash found — pool may be inactive"
    echo "   Manual alternative: check Arbiscan for $RAMSES_POOL → Transactions"
  fi
else
  echo "   ⚠️  Skipped — Ramses pool not found"
fi
echo ""

# ─────────────────────────────────────────────────────────────
# TASK 4: Verify exactInputSingle selector (0x414bf389) in
#         router bytecode — Boss-required ABI confirmation
# ─────────────────────────────────────────────────────────────
echo "── TASK 4: exactInputSingle selector check ──"
echo "   Selector: 0x${EXACT_INPUT_SINGLE_SELECTOR}"
SELECTOR_FOUND="NO"

if [[ "$RAMSES_ROUTER" != "UNKNOWN" && -n "$RAMSES_ROUTER" ]]; then
  echo "   Router: $RAMSES_ROUTER"
  BYTECODE=$(cast code "$RAMSES_ROUTER" --rpc-url "$RPC" 2>/dev/null) || BYTECODE=""
  if [[ ${#BYTECODE} -gt 4 ]]; then
    if echo "$BYTECODE" | grep -qi "$EXACT_INPUT_SINGLE_SELECTOR"; then
      SELECTOR_FOUND="YES"
      ok "Selector 0x414bf389 FOUND — router supports exactInputSingle"
    else
      echo "   ❌ Selector NOT found in bytecode"
      echo "   This may NOT be the CL router. tx.to could be an aggregator."
      echo "   Try checking the Swap event's 'sender' address instead."
    fi
  else
    echo "   ❌ Empty/EOA bytecode — tx.to is an EOA, not the router"
    echo "   The actual router is likely an intermediate contract."
  fi
else
  warn "Router unknown — selector check skipped"
fi
echo ""

# ─────────────────────────────────────────────────────────────
# TASK 5: Legacy router sanity check (should NOT have selector)
# ─────────────────────────────────────────────────────────────
echo "── TASK 5: Legacy router selector sanity check ──"
LEGACY_BC=$(cast code "$LEGACY_ROUTER" --rpc-url "$RPC" 2>/dev/null) || LEGACY_BC=""
if echo "$LEGACY_BC" | grep -qi "$EXACT_INPUT_SINGLE_SELECTOR"; then
  warn "Legacy 0xAAA87963... DOES contain 0x414bf389 — re-examine which is legacy vs CL"
else
  ok "Legacy 0xAAA87963... does NOT have exactInputSingle — confirmed NOT the CL router"
fi
echo ""

# ─────────────────────────────────────────────────────────────
# SUMMARY — Boss report
# ─────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "  BOSS REPORT — ADDRESS VERIFICATION RESULTS"
echo "  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  UniV3 WETH/USDC 0.01% pool:      $UNI_POOL"
echo "  Ramses WETH/USDC 0.05% pool:     $RAMSES_POOL"
echo "  Ramses CL SwapRouter (tx.to):    $RAMSES_ROUTER"
echo "  exactInputSingle 0x414bf389:     $SELECTOR_FOUND"
echo ""
echo "  Tx hash used for router trace:   ${TX_HASH_FOUND:-N/A}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "NOTE: If selector = NO, the tx.to may be an aggregator (1inch, paraswap)."
echo "      In that case, look at internal txns of $TX_HASH_FOUND"
echo "      to find which contract called the Ramses pool's swap()."
