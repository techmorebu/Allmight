# PROJECT STATE CURRENT

<!-- STATUS: CURRENT | Last Reviewed: 2026-03-27 -->
<!-- Supersedes: all prior architecture or execution planning docs -->

## Current Phase
Surface Discovery & Classification (Pre-Execution)

## Primary Chain
Arbitrum mainnet

## Current Objective
Build a surface inventory framework that scans, classifies, and ranks candidate
pools/venues without adding execution logic.

## Core Insight
Edge appears when price moves into pre-existing liquidity zones (tick map),
not from assuming that new LP events create edge by themselves.

## Best Current Research Target
ARB/USDC UniV3 vs Camelot V3

## Validated Surfaces (breakeven engine v1)

| Surface                              | Avg Spread | Fee Burden | Avg Net   | Classification     |
|--------------------------------------|-----------|------------|-----------|-------------------|
| ETH/USDC:univ3-camelotv2             | 0.0594%   | 0.3500%    | -0.2906%  | BLOCKED_FEE       |
| ARB/USD:univ3-direct-vs-synthetic    | 0.0715%   | 0.1500%    | -0.0785%  | BLOCKED_FEE       |
| ARB/USDC:univ3-camelotv3-direct      | 0.1110%   | 0.0749%    | +0.0361%  | BLOCKED_LIQUIDITY |
| WBTC/USD:univ3-direct-vs-synthetic   | 0.0276%   | 0.1500%    | -0.1224%  | BLOCKED_FEE       |

## Current Blocker
**ARB/USDC active-tick depth** — UniV3 ARB/USDC = $3,090 (too thin).
Camelot V3 = $56,016 (deep). Need a second deep venue to complete the surface.

## In Scope
- discovery
- pool inventory and active-tick depth measurement (L x sqrtP)
- fast classification via breakeven engine
- validation routing (8-step sequence)
- ranking candidate surfaces
- selective fetcher hardening only when directly justified

## Out of Scope
- execution logic (frozen)
- flash loan orchestration (frozen)
- contract rewrites (frozen)
- broad chain expansion (frozen -- Arbitrum only)
- capital deployment / vault logic (frozen)

## Next Build Target
Surface Inventory Framework -- scan candidate venues, classify by depth + fee,
feed only passing surfaces into the existing validation stack.

## Priority Queue (Boss-approved 2026-03-19)
1. PRIORITY 1 -- Fix ARB/USDC blocked_liquidity
   - Target: venue with active-tick depth > $10k, fee <= 0.10%
   - NOT UniV3 ARB/USDC (confirmed $3,090)
   - native USDC (0xaf88..) preferred
   - Candidates: SushiSwap V3, Ramses V2, UniV3 alt fee tiers
2. PRIORITY 2 -- WBTC blocked_fee investigation
   - Research 1-hop WBTC/USDC venue <= 0.05%
   - Or test WBTC/WETH at different time window (burst-trading noted)

## Hard Rules (session 2026-03-19, Boss-approved)
1. Same-block anchoring mandatory -- tag every measurement with block number
2. Active-tick depth = L x sqrtP -- NEVER use GeckoTerminal TVL as proxy
3. Fee burden checked before excitement
4. Blocker classes are distinct: blocked_fee / blocked_liquidity / blocked_slippage
5. Always verify on-disk state before patching
6. Promise.all only within single rpc.call() on same contract

## Key Addresses (Arbitrum mainnet)
    ARB:           0x912CE59144191C1204E64559FE8253a0e49E6548  (18 dec)
    native USDC:   0xaf88d065e77c8cC2239327C5EDb3A432268e5831  (6 dec)   <- USE THIS
    USDCe:         0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8  (6 dec)   <- AVOID
    WETH:          0x82aF49447D8a07e3bd95BD0d56f35241523fBab1  (18 dec)
    WBTC:          0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f  (8 dec)

## Health Check Commands
    node -r dotenv/config scripts/data_collection/masterFetcher/arbitrumFetcher.js
    # expect: status=success partial=false success=9 failed=0

    node scripts/tools/breakeven_report.js
    # expect: 4 surfaces, ARB/USDC = BLOCKED_LIQUIDITY, rest = BLOCKED_FEE
