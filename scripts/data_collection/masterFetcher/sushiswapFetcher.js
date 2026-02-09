// scripts/data_collection/masterFetcher/sushiswapFetcher.js
// Phase 1 - Sushiswap Data Fetcher
// Fetches swap data from Sushiswap via TheGraph API
// Cross-DEX arbitrage detection vs Uniswap V3

require('dotenv').config();
const fetch = require('node-fetch');

/**
 * Sushiswap Fetcher
 * 
 * Fetches real-time swap and pair data from Sushiswap
 * Focus: Same pairs as Uniswap for cross-DEX arbitrage
 * 
 * @returns {Object} Normalized swap and pair data
 */
module.exports = async function sushiswapFetcher() {
  const SUBGRAPH_URL = process.env.SUSHISWAP_API_KEY || 
    'https://api.thegraph.com/subgraphs/name/sushiswap/exchange';
  
  const startTime = Date.now();
  
  try {
    // Target the same token pairs as Uniswap for arbitrage
    // Sushiswap uses different pool addresses but same tokens
    const TARGET_TOKENS = {
      WETH: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      DAI: '0x6b175474e89094c44da98b954eedeac495271d0f'
    };
    
    // GraphQL query for pairs and their current state
    const pairsQuery = `
      query GetPairs($tokens: [Bytes!]!) {
        pairs(
          first: 10
          orderBy: reserveUSD
          orderDirection: desc
          where: {
            token0_in: $tokens
            token1_in: $tokens
          }
        ) {
          id
          token0 {
            id
            symbol
            decimals
            derivedETH
          }
          token1 {
            id
            symbol
            decimals
            derivedETH
          }
          reserve0
          reserve1
          reserveETH
          reserveUSD
          token0Price
          token1Price
          volumeToken0
          volumeToken1
          volumeUSD
          txCount
          timestamp
        }
      }
    `;
    
    // GraphQL query for recent swaps
    const swapsQuery = `
      query GetRecentSwaps($timestamp: Int!) {
        swaps(
          first: 100
          orderBy: timestamp
          orderDirection: desc
          where: {
            timestamp_gt: $timestamp
          }
        ) {
          id
          timestamp
          pair {
            id
            token0 {
              symbol
            }
            token1 {
              symbol
            }
          }
          sender
          amount0In
          amount1In
          amount0Out
          amount1Out
          amountUSD
          to
        }
      }
    `;
    
    // Fetch pair data
    const pairsResponse = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: pairsQuery,
        variables: {
          tokens: Object.values(TARGET_TOKENS)
        }
      })
    });
    
    if (!pairsResponse.ok) {
      throw new Error(`TheGraph API error: ${pairsResponse.status} ${pairsResponse.statusText}`);
    }
    
    const pairsData = await pairsResponse.json();
    
    if (pairsData.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(pairsData.errors)}`);
    }
    
    // Fetch recent swaps (last 5 minutes)
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
    
    const swapsResponse = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: swapsQuery,
        variables: {
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
    
    // Process pairs
    const pairs = pairsData.data?.pairs || [];
    const swaps = swapsData.data?.swaps || [];
    
    // Calculate current prices
    const prices = pairs.map(pair => ({
      pairId: pair.id,
      pair: `${pair.token0.symbol}/${pair.token1.symbol}`,
      price: parseFloat(pair.token0Price),
      inversePrice: parseFloat(pair.token1Price),
      reserve0: parseFloat(pair.reserve0),
      reserve1: parseFloat(pair.reserve1),
      reserveUSD: parseFloat(pair.reserveUSD),
      volume24h: parseFloat(pair.volumeUSD),
      txCount: pair.txCount,
      // Calculate price impact for various trade sizes
      priceImpact: {
        size_1000: calculatePriceImpact(parseFloat(pair.reserve0), parseFloat(pair.reserve1), 1000),
        size_10000: calculatePriceImpact(parseFloat(pair.reserve0), parseFloat(pair.reserve1), 10000),
        size_50000: calculatePriceImpact(parseFloat(pair.reserve0), parseFloat(pair.reserve1), 50000)
      }
    }));
    
    // Process recent swaps
    const recentSwaps = swaps
      .filter(swap => swap.pair) // Ensure pair data exists
      .map(swap => {
        const amount0In = parseFloat(swap.amount0In);
        const amount1In = parseFloat(swap.amount1In);
        const amount0Out = parseFloat(swap.amount0Out);
        const amount1Out = parseFloat(swap.amount1Out);
        
        // Determine swap direction
        const isToken0Sell = amount0In > 0 && amount1Out > 0;
        
        return {
          timestamp: parseInt(swap.timestamp),
          pair: `${swap.pair.token0.symbol}/${swap.pair.token1.symbol}`,
          pairId: swap.pair.id,
          amount0In,
          amount1In,
          amount0Out,
          amount1Out,
          amountUSD: parseFloat(swap.amountUSD),
          direction: isToken0Sell ? 'SELL_TOKEN0' : 'BUY_TOKEN0'
        };
      });
    
    // Calculate statistics
    const stats = {
      totalPairs: pairs.length,
      totalSwaps: recentSwaps.length,
      totalVolumeUSD: recentSwaps.reduce((sum, s) => sum + s.amountUSD, 0),
      avgSwapSize: recentSwaps.length > 0
        ? recentSwaps.reduce((sum, s) => sum + s.amountUSD, 0) / recentSwaps.length
        : 0,
      totalTVL: pairs.reduce((sum, p) => sum + parseFloat(p.reserveUSD), 0)
    };
    
    const duration = Date.now() - startTime;
    
    return {
      fetcher: 'sushiswapFetcher',
      exchange: 'sushiswap',
      timestamp: new Date().toISOString(),
      durationMs: duration,
      status: 'success',
      data: {
        prices,
        recentSwaps,
        pairs: pairs.map(p => ({
          id: p.id,
          pair: `${p.token0.symbol}/${p.token1.symbol}`,
          token0: {
            address: p.token0.id,
            symbol: p.token0.symbol,
            decimals: p.token0.decimals,
            derivedETH: p.token0.derivedETH
          },
          token1: {
            address: p.token1.id,
            symbol: p.token1.symbol,
            decimals: p.token1.decimals,
            derivedETH: p.token1.derivedETH
          },
          reserve0: parseFloat(p.reserve0),
          reserve1: parseFloat(p.reserve1),
          reserveUSD: parseFloat(p.reserveUSD),
          volumeUSD: parseFloat(p.volumeUSD),
          txCount: p.txCount
        })),
        stats
      }
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    return {
      fetcher: 'sushiswapFetcher',
      exchange: 'sushiswap',
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

/**
 * Calculate price impact for a given trade size
 * Using constant product formula: x * y = k
 * 
 * @param {number} reserve0 - Reserve of token0
 * @param {number} reserve1 - Reserve of token1
 * @param {number} tradeSize - Trade size in token0
 * @returns {number} Price impact as percentage
 */
function calculatePriceImpact(reserve0, reserve1, tradeSize) {
  if (reserve0 === 0 || reserve1 === 0) return 0;
  
  // Calculate output amount using constant product formula
  // amountOut = (amountIn * reserve1) / (reserve0 + amountIn)
  const amountOut = (tradeSize * reserve1) / (reserve0 + tradeSize);
  
  // Calculate price before and after trade
  const priceBefore = reserve1 / reserve0;
  const priceAfter = (reserve1 - amountOut) / (reserve0 + tradeSize);
  
  // Price impact as percentage
  const impact = ((priceAfter - priceBefore) / priceBefore) * 100;
  
  return Math.abs(impact);
}

// Allow running standalone for testing
if (require.main === module) {
  (async () => {
    console.log('Testing Sushiswap Fetcher...\n');
    const result = await module.exports();
    console.log(JSON.stringify(result, null, 2));
    
    if (result.status === 'success') {
      console.log('\n✅ Fetcher executed successfully');
      console.log(`📊 Stats: ${result.data.stats.totalSwaps} swaps, $${result.data.stats.totalVolumeUSD.toFixed(2)} volume`);
      console.log(`💰 Total TVL: $${result.data.stats.totalTVL.toFixed(2)}`);
      console.log(`🏊 Pairs monitored: ${result.data.stats.totalPairs}`);
    } else {
      console.log('\n❌ Fetcher failed');
      console.log(`Error: ${result.error.message}`);
    }
  })();
}
