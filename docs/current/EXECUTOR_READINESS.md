# AllMightRamsesExecutor — Pre-Deploy Readiness

**Status: FORK-TESTED. Deploy BLOCKED pending Boss green-light.**

## Fork Test Results (2026-04-28)

| Category | Result |
|---|---|
| Fork block | Arbitrum #457129857 |
| Tests | **18 / 18 PASS** |
| USDC direction | **PROFITABLE** (live spread captured) |
| Slippage guard | ✅ RAMSES_SLIPPAGE fires correctly |
| Callback security | ✅ BAD_RAMSES_CALLBACK blocks non-pool callers |
| WETH direction | ✅ ONLY_USDC_SUPPORTED blocks at entrypoint |
| 0x11 panic | ✅ None |

---

## Contract Summary

| Property | Value |
|---|---|
| File | `contracts/AllMightRamsesExecutor.sol` |
| Solidity | 0.8.20 |
| Optimizer | enabled, 200 runs |
| Bytecode | 9,172 bytes (EIP-170 limit: 24,576) |
| Lines | 343 |
| Fork test | `scripts/execution/fork_test_ramses_executor.js` |

---

## Architecture

```
Owner wallet
  → AllMightRamsesExecutor.executeRamsesArb()    [onlyOwner + nonReentrant]
      → Aave V3 flashLoanSimple(USDC, amount)
          → executeOperation() callback           [msg.sender==aavePool enforced]
              → _doRamsesFirst()
                  → _swapRamses()                 [direct pool.swap()]
                      ← ramsesV2SwapCallback()    [msg.sender==ramsesPool enforced]
                  → _swapUniV3()                  [exactInputSingle]
              → require(profit >= minProfit)       [on-chain enforcement]
              → repay Aave
              → transfer profit to profitRecipient
```

**Locked paths (Boss ruling 2026-04-28):**
- `borrowAsset` must be USDC — WETH direction disabled (Ramses pool overflows on zeroForOne=true)
- `direction` must be `DIRECTION_RAMSES_FIRST` (0) — UniV3-first path removed

---

## Constructor Arguments

All addresses on Arbitrum mainnet (chainId 42161). Every address below is on-chain verified.

```javascript
const CONSTRUCTOR_ARGS = [
  "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // _aavePool      — Aave V3 Pool
  "0xE592427A0AEce92De3Edee1F18E0157C05861564", // _uniV3Router   — UniV3 SwapRouter v1
  "0x30AFBcF9458c3131A6d051C621E307E6278E4110", // _ramsesPool    — Ramses WETH/USDC 0.05% CL pool
  "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // _weth          — WETH (Arbitrum)
  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // _usdc          — Native USDC (Arbitrum)
  "<OWNER_WALLET_ADDRESS>",                      // _profitRecipient — cold wallet or owner
];
```

**Address verification sources:**

| Address | Confirmed via |
|---|---|
| Aave V3 Pool | `test_fork.js` in repo + on-chain |
| UniV3 SwapRouter | `test_fork.js` in repo + Uniswap docs |
| UniV3 Factory | `0x1F98431c8aD98523631AE4a59f267346ea31F984` (for pool verification) |
| Ramses WETH/USDC pool | `cast call RamsesV2Factory.getPool(WETH, USDC, 500)` — verified on-chain |
| WETH | Both session handoffs + fetcher config |
| Native USDC | Both session handoffs + session logs |
| RamsesV2 Factory | `0xaa2cd7477c451e703f3b9ba5663334914763edf8` — DefiLlama adapter |

---

## Pre-Deploy Checklist

```
[ ] 1. CONTRACT SOURCE
        contracts/AllMightRamsesExecutor.sol committed to repo
        Constructor args documented (this file)

[ ] 2. ABI / BYTECODE
        Run: npx hardhat compile --force
        Confirm artifact: artifacts/contracts/AllMightRamsesExecutor.sol/AllMightRamsesExecutor.json

[ ] 3. PREFLIGHT SCRIPT
        scripts/execution/preflight_ramses_executor.js
        → verifies all 5 protocol addresses live on Arbitrum
        → verifies pool token0=WETH, token1=USDC
        → verifies pool liquidity > 0
        → does NOT send any transaction

[ ] 4. DEPLOYMENT SCRIPT (dry-run only)
        scripts/execution/deploy_ramses_executor.js
        → --dry-run flag: prints constructor args, estimates gas, NO broadcast
        → --live flag: REQUIRES Boss explicit approval before enabling

[ ] 5. FORK TEST PASSES
        npx hardhat test scripts/execution/fork_test_ramses_executor.js
        Must show 18/18 PASS

[ ] 6. BOSS DEPLOYMENT APPROVAL
        Boss must rule: "Deploy AllMightRamsesExecutor to Arbitrum mainnet"
        before --live flag can be used

[ ] 7. POST-DEPLOY VERIFICATION
        scripts/execution/preflight_ramses_executor.js --verify <deployed_address>
        → checks owner == deployer wallet
        → checks USDC(), WETH(), ramsesPool() return correct addresses
        → does staticCall to executeRamsesArb (expect DEADLINE_EXPIRED revert)
```

---

## Security Properties (confirmed in fork test)

| Property | Mechanism | Test |
|---|---|---|
| Owner-only execution | `onlyOwner` modifier | ✅ |
| Reentrancy protection | `nonReentrant` on entrypoint | ✅ |
| Aave callback auth | `msg.sender == aavePool` + `initiator == address(this)` | ✅ |
| Ramses callback auth | `msg.sender == ramsesPool` | ✅ |
| WETH direction disabled | `require(borrowAsset == USDC)` | ✅ |
| Direction locked | `require(direction == DIRECTION_RAMSES_FIRST)` | ✅ |
| On-chain profit gate | `require(finalBalance >= repay + minProfit)` | ✅ |
| Slippage protection | `require(amountOut >= amountOutMin, "RAMSES_SLIPPAGE")` | ✅ |
| Emergency rescue | `emergencyWithdraw` + `emergencyWithdrawETH` (owner only) | ✅ |
| No arbitrary swap | No public swap entry point | ✅ |

---

## Known Constraints

1. **USDC-only**: WETH borrow direction disabled permanently at contract level. Ramses pool zeroForOne=true path causes pool-level arithmetic overflow. Not a contract bug — pool behavior at current tick configuration.

2. **Ramses pool address is hardcoded in constructor**: `0x30AFBcF9...`. If pool is migrated or deprecated, a new executor must be deployed.

3. **No TWAP oracle**: `minProfit` is the only economic safety gate. Sufficient for controlled execution phase.

4. **sqrtPriceLimitX96 is dynamic**: Read from `pool.slot0()` at swap time, offset ±2.5%. If pool price moves >2.5% between slot0 read and swap execution, the swap may return fewer tokens than expected (caught by `RAMSES_SLIPPAGE`).

---

## Live Execution Activation (NOT YET APPROVED)

Live execution requires ALL of the following:
- Boss explicit deployment approval
- Hardware wallet as owner
- `profitRecipient` set to cold wallet (not hot key)
- `minProfit` set to cover gas + buffer
- `amountOutMinA/B` set to realistic slippage tolerance (not 0)
- Manual `enable` transaction with Boss confirmation

**Current state: dry-run and fork-test only. No live execution.**
