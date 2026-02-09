// scripts/data_collection/masterFetcher/uniswapV3Fetcher.js
// Phase 1 - Uniswap V3 Data Fetcher
// Fetches swap data from Uniswap V3 via TheGraph API
// Self-funding via flash loans - tracks liquidity and price data

require('dotenv').config();
const fetch = require('node-fetch');

/**
 * Uniswap V3 Fetcher
 * 
 * Fetches real-time swap and pool data from Uniswap V3
 * Focus: ETH/USDC, ETH/DAI, USDC/DAI pools for triangle arbitrage
 * 
 * @returns {Object} Normalized swap and pool data
 */
module.exports = async function uniswapV3Fetcher() {
  const SUBGRAPH_URL = process.env.UNISWAP_V3_SUBGRAPH || 
    'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3';
  
  const startTime = Date.now();
  
  try {
    // Define target pools for flash loan arbitrage
    // These are the main liquidity pools we'll monitor
    const TARGET_POOLS = [
      '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', // ETH/USDC 0.05%
      '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8', // ETH/USDC 0.3%
      '0x60594a405d53811d3bc4766596efd80fd545a270', // ETH/DAI 0.05%
      '0xc2e9f25be6257c210d7adf0d4cd6e3e881ba25f8', // ETH/DAI 0.3%
      '0x5777d92f208679db4b9778590fa3cab3ac9e2168', // USDC/DAI 0.01%
    ];
    
    // GraphQL query for recent swaps
    const swapsQuery = `
      query GetRecentSwaps($pools: [String!]!, $timestamp: Int!) {
        swaps(
          first: 100
          orderBy: timestamp
          orderDirection: desc
          where: {
            pool_in: $pools
            timestamp_gt: $timestamp
          }
        ) {
          id
          timestamp
          pool {
            id
            token0 {
              id
              symbol
              decimals
            }
            token1 {
              id
              symbol
              decimals
            }
            feeTier
            liquidity
            sqrtPrice
            tick
          }
          sender
          recipient
          amount0
          amount1
          amountUSD
          sqrtPriceX96
          tick
          logIndex
        }
      }
    `;
    
    // GraphQL query for pool states
    const poolsQuery = `
      query GetPools($pools: [String!]!) {
        pools(where: { id_in: $pools }) {
          id
          token0 {
            id
            symbol
            decimals
          }
          token1 {
            id
            symbol
            decimals
          }
          feeTier
          liquidity
          sqrtPrice
          tick
          token0Price
          token1Price
          volumeUSD
          txCount
          totalValueLockedUSD
          totalValueLockedToken0
          totalValueLockedToken1
        }
      }
    `;
    
    // Timestamp for recent swaps (last 5 minutes)
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    
    // Fetch recent swaps
    const swapsResponse = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: swapsQuery,
        variables: {
          pools: TARGET_POOLS,
          timestamp: fiveMinutesAgo
        }
      })
    });
    
    if (!swapsResponse.ok) {
      throw new Error(`TheGraph API error: ${swapsResponse.status} ${swapsResponse.statusText}`);
    }
    
    const swapsData = await swapsResponse.json();
    
    if (swapsData.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(swapsData.errors)}`);
    }
    
    // Fetch current pool states
    const poolsResponse = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: poolsQuery,
        variables: {
          pools: TARGET_POOLS
        }
      })
    });
    
    if (!poolsResponse.ok) {
      throw new Error(`TheGraph API error: ${poolsResponse.status} ${poolsResponse.statusText}`);
    }
    
    const poolsData = await poolsResponse.json();
    
    if (poolsData.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(poolsData.errors)}`);
    }
    
    // Process and normalize the data
    const swaps = swapsData.data?.swaps || [];
    const pools = poolsData.data?.pools || [];
    
    // Calculate current prices from pool states
    const prices = pools.map(pool => {
      // Convert sqrtPriceX96 to actual price
      // Formula: price = (sqrtPrice / 2^96)^2
      const sqrtPrice = BigInt(pool.sqrtPrice);
      const Q96 = BigInt(2) ** BigInt(96);
      const price = Number(sqrtPrice * sqrtPrice * BigInt(10000)) / Number(Q96 * Q96) / 10000;
      
      return {
        poolId: pool.id,
        pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
        price: price,
        inversePricePrice: 1 / price,
        liquidity: pool.liquidity,
        tvlUSD: parseFloat(pool.totalValueLockedUSD),
        volume24h: parseFloat(pool.volumeUSD),
        feeTier: pool.feeTier,
        token0Price: parseFloat(pool.token0Price),
        token1Price: parseFloat(pool.token1Price)
      };
    });
    
    // Process recent swaps for volume analysis
    const recentSwaps = swaps.map(swap => ({
      timestamp: parseInt(swap.timestamp),
      pool: `${swap.pool.token0.symbol}/${swap.pool.token1.symbol}`,
      poolId: swap.pool.id,
      amount0: parseFloat(swap.amount0),
      amount1: parseFloat(swap.amount1),
      amountUSD: parseFloat(swap.amountUSD),
      feeTier: swap.pool.feeTier,
      // Direction: positive amount0 means selling token0 for token1
      direction: parseFloat(swap.amount0) > 0 ? 'SELL_TOKEN0' : 'BUY_TOKEN0'
    }));
    
    // Calculate aggregate statistics
    const stats = {
      totalSwaps: swaps.length,
      totalVolumeUSD: recentSwaps.reduce((sum, s) => sum + s.amountUSD, 0),
      avgSwapSize: recentSwaps.length > 0 
        ? recentSwaps.reduce((sum, s) => sum + s.amountUSD, 0) / recentSwaps.length 
        : 0,
      poolsMonitored: pools.length,
      totalTVL: pools.reduce((sum, p) => sum + parseFloat(p.totalValueLockedUSD), 0)
    };
    
    const duration = Date.now() - startTime;
    
    return {
      fetcher: 'uniswapV3Fetcher',
      exchange: 'uniswap_v3',
      timestamp: new Date().toISOString(),
      durationMs: duration,
      status: 'success',
      data: {
        prices,
        recentSwaps,
        pools: pools.map(p => ({
          id: p.id,
          pair: `${p.token0.symbol}/${p.token1.symbol}`,
          token0: {
            address: p.token0.id,
            symbol: p.token0.symbol,
            decimals: p.token0.decimals
          },
          token1: {
            address: p.token1.id,
            symbol: p.token1.symbol,
            decimals: p.token1.decimals
          },
          feeTier: p.feeTier,
          liquidity: p.liquidity,
          tvlUSD: parseFloat(p.totalValueLockedUSD),
          volumeUSD: parseFloat(p.volumeUSD),
          txCount: p.txCount
        })),
        stats
      }
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    return {
      fetcher: 'uniswapV3Fetcher',
      exchange: 'uniswap_v3',
      timestamp: new Date().toISOString(),
      durationMs: duration,
      status: 'error',
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    };
  }
};

// Allow running standalone for testing
if (require.main === module) {
  (async () => {
    console.log('Testing Uniswap V3 Fetcher...\n');
    const result = await module.exports();
    console.log(JSON.stringify(result, null, 2));
    
    if (result.status === 'success') {
      console.log('\n✅ Fetcher executed successfully');
      console.log(`📊 Stats: ${result.data.stats.totalSwaps} swaps, $${result.data.stats.totalVolumeUSD.toFixed(2)} volume`);
      console.log(`💰 Total TVL: $${result.data.stats.totalTVL.toFixed(2)}`);
    } else {
      console.log('\n❌ Fetcher failed');
      console.log(`Error: ${result.error.message}`);
    }
  })();
}
