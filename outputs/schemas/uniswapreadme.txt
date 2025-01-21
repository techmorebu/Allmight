Relevant Uniswap Data
The schema provides rich details for various entities. Key components include:

Liquidity Pools:

Type: Pool
Fields:
token0, token1 (symbols, prices)
liquidity, volumeToken0, volumeToken1, volumeUSD
collectedFeesToken0, collectedFeesToken1
totalValueLockedToken0, totalValueLockedToken1
poolDayData, poolHourData
Transactions:

Types: Swap, Mint, Burn
Fields:
pool, amountUSD, timestamp, token0, token1
Historical Data:

Types: PoolDayData, PoolHourData
Fields:
volumeUSD, feesUSD, liquidity, txCount, token0Price, token1Price
Tokens:

Type: Token
Fields:
volume, volumeUSD, feesUSD, totalValueLocked, priceUSD
Aggregate Metrics:

Types: UniswapDayData, Factory
Fields:
totalVolumeUSD, totalVolumeETH, totalValueLockedUSD
DEX Type and Usefulness
DEX Type: Uniswap is a decentralized exchange (DEX) using an automated market maker (AMM) model.
Usefulness:
Provides comprehensive pool-level and token-level data.
Supports historical analysis through day/hour snapshots.
Suitable for trends, arbitrage, and scalping strategies.
Next Steps
Develop Specific Fetcher:

Fetch pools and transactions meeting thresholds for liquidity and volume.
Retrieve historical data for analysis.
Validate Data Retrieval:

Test key queries to ensure schema compatibility.
Document Findings:

Highlight Uniswap's role in the project's goals.
