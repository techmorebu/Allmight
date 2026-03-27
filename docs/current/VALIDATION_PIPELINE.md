# VALIDATION PIPELINE

<!-- STATUS: CURRENT | Last Reviewed: 2026-03-27 -->

Standard 8-step sequence for any new pool/surface.
Do not skip steps. Do not reorder.

## Step 1 -- On-chain smoke test
    node -r dotenv/config -e "
      // probe: slot0() or globalState(), liquidity(), token0(), token1()
      // confirm: price sane, token addresses match known tokens
      // confirm: native USDC (0xaf88..) not USDCe (0xFF97..)
    "

## Step 2 -- Add to arbitrumFetcher.js
- Include TOKEN-ORDER-GUARD (sanityMin / sanityMax bounds)
- For Algebra pools (Camelot V3, Ramses): use fetchCamelotV3Pool() path
- Do NOT merge Algebra logic with UniV3 logic

## Step 3 -- Run arbitrum fetcher
    node -r dotenv/config scripts/data_collection/masterFetcher/arbitrumFetcher.js
    # expect: status=success partial=false success=N failed=0

## Step 4 -- Run master fetcher
    node -r dotenv/config scripts/master-fetcher.js

## Step 5 -- Run spread validator (10 samples, same-block)
- Every sample must be tagged with block number
- Cross-session comparisons are invalid (5-14x inflation artifact)

## Step 6 -- Measure active-tick depth (L x sqrtP)
    activeTick_usd = (L x sqrtP / 10^dec1) x 2

- Measure for BOTH venues before classifying surface quality
- Reference: UniV3 ARB/USDC = $3,090 | Camelot V3 ARB/USDC = $56,016
- NEVER use GeckoTerminal TVL as proxy

## Step 7 -- Add to breakeven_report.js and run
    node scripts/tools/breakeven_report.js

## Step 8 -- Report to Boss
State: classification, blocker, active-tick depth, fee burden.
Await Boss ruling before any further work on that surface.

## Blocker Classes (distinct -- treat separately)

| Class | Meaning | Next Action |
|---|---|---|
| blocked_fee | fee > spread | find lower-fee venue or reduce hop count |
| blocked_liquidity | thin active-tick depth | find deeper venue (same pair, NOT higher TVL) |
| blocked_slippage | notional too large | reduce size or wait for depth increase |
| monitored | conditions not met yet | watch, do not force-expand |
