# AllMight Known Issues

## Active Issues

### DAI/USDC price returns 0.000000
- **Status**: Pool removed from fetchers pending fix
- **Affected**: arbitrumFetcher.js, optimismFetcher.js  
- **Root cause**: sqrtPriceX96 decimal adjustment wrong for DAI(18dec)/USDC(6dec)
- **Fix**: Verify on-chain token0/token1 order, then apply correct:
  `price = (sqrtP/2^96)^2 * 10^(dec1-dec0)`
- **Priority**: Low -- DAI pools have low TVL vs primary targets

### tvlUSD in UniV3 fetchers stores raw wei values
- **Status**: Workaround in shadow_mode.py (uses liquidity field as proxy)
- **Affected**: All UniV3 fetchers
- **Root cause**: Liquidity * price calculation not normalized by token decimals
- **Fix**: In each fetcher, divide by appropriate decimal adjustment
- **Priority**: Medium -- affects pool size filtering accuracy

### Unichain fetcher returns 0 pools
- **Status**: Deferred
- **Root cause**: UniV3 V4 PoolManager ABI not implemented
- **Fix**: Implement V4 subgraph query or PoolManager multicall
- **Priority**: Low -- Unichain is a secondary chain

### Balancer Arbitrum returns 0 pools  
- **Status**: Deferred
- **Root cause**: REST API blocked by network policy
- **Fix**: Use Balancer Vault direct multicall instead of REST
- **Priority**: Low -- Balancer is a secondary venue
