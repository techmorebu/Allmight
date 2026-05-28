# Phase 2A Census — Pre-Expansion Observatory Baseline

First verified proof that the AllMight observatory is **multi-surface and
multi-chain**. Captured before any geometry-completion changes (Phase 2A.1).

## Snapshot
- Census run: 2026-05-28T15:50:02Z (chained: master-fetcher once + audit)
- Fetchers live: 12 across 6 chains (arbitrum, ethereum, base, optimism,
  unichain, global)
- Observed pairs: 16

## Registered surface status at baseline
- eth_usdc_ramses .... FULL  (scorer FULL; 8 venues observed; breakeven 17.4)
- dai_usdc_candidate .. PARTIAL (uniswap_v3, curve, camelot_v3; no breakeven)
- eth_usdt_candidate .. PARTIAL (uniswap_v3, sushiswap_v3, curve, camelot_v3)
- arb_usdc_candidate .. PARTIAL (→ to be ARCHIVED_CANDIDATE per Boss ruling)

## Candidate discovery (observed but unregistered)
USDC/USDT (curve, uniswap_v3) — Boss priority #2, flowing pre-registration.
Also: WBTC/USDC, WBTC/USDT, AAVE/ETH, LINK/ETH, UNI/ETH, WBTC/ETH, ARB/ETH,
DAI/ETH, GMX/USDC, MATIC/ETH, UNI/USDC.

## Boss Phase 2A ruling context
- Bottleneck is now economic geometry, not telemetry plumbing.
- Surfaces are CHAIN-SCOPED (arbitrum:DAI/USDC ≠ base:DAI/USDC).
- Priority: DAI/USDC → USDC/USDT → ETH/USDT. ARB/USDC archived. WBTC/* deferred.
- Snapshot truth achieved; behavioral truth (2A.2) requires longitudinal accumulation.

## Status
Tool: scripts/tools/surface_telemetry_audit.js (committed 08108ec)
Live trading: STILL LOCKED | Capital: STILL SAFE | Fetcher = observation only
