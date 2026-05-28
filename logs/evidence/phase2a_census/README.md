# Phase 2A Census — Pre-Expansion Observatory Baseline

First verified proof the AllMight observatory is multi-surface and multi-chain.
Captured before Phase 2A.1 geometry completion begins.

## Snapshot
- Census run: 2026-05-28T15:50:02Z (master-fetcher once + audit)
- Fetchers: 12 across 6 chains (arbitrum, ethereum, base, optimism, unichain, global)
- Observed pairs: 16

## Registered surfaces at baseline
- eth_usdc_ramses: FULL (scorer FULL; 8 venues; breakeven 17.4)
- dai_usdc_candidate: PARTIAL (uniswap_v3, curve, camelot_v3; no breakeven)
- eth_usdt_candidate: PARTIAL (uniswap_v3, sushiswap_v3, curve, camelot_v3)
- arb_usdc_candidate: PARTIAL (to be ARCHIVED_CANDIDATE per Boss ruling)

## Candidate discovery (observed, unregistered)
USDC/USDT (curve, uniswap_v3) — Boss priority #2, flowing pre-registration.
Also: WBTC/USDC, WBTC/USDT, AAVE/ETH, LINK/ETH, UNI/ETH, WBTC/ETH, ARB/ETH, DAI/ETH, GMX/USDC, MATIC/ETH, UNI/USDC.

## Boss Phase 2A ruling
- Surfaces are CHAIN-SCOPED (arbitrum:DAI/USDC != base:DAI/USDC).
- Priority: DAI/USDC -> USDC/USDT -> ETH/USDT. ARB/USDC archived. WBTC deferred.
- Snapshot truth achieved; behavioral truth (2A.2) needs longitudinal accumulation.

## Status
Tool: scripts/tools/surface_telemetry_audit.js (commit 08108ec)
Live trading: LOCKED | Capital: SAFE | Fetcher = observation only
