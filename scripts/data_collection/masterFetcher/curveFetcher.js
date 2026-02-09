// scripts/data_collection/masterFetcher/curveFetcher.js
// Phase 1 - Curve Finance Data Fetcher
// Fetches stablecoin pool data from Curve Finance
// Specializes in low-slippage stablecoin arbitrage

require('dotenv').config();
const fetch = require('node-fetch');

/**
 * Curve Finance Fetcher
 * 
 * Fetches pool data from Curve Finance API
 * Focus: Stablecoin pools (3pool, FRAX, etc.) for low-risk arbitrage
 * 
 * Note: Curve uses its own API, not TheGraph
 * 
 * @returns {Object} Normalized pool data
 */
module.exports = async function curveFetcher() {
  const CURVE_API = process.env.CURVE_API || 'https://api.curve.fi/api';
  const CURVE_THEGRAPH = process.env.CURVE_FINANCE_ETHEREUM_API;
  
  const startTime = Date.now();
  
  try {
    // Fetch pool data from Curve API
    // Endpoints: /getPools/ethereum/main for all pools
    const poolsResponse = await fetch(`${CURVE_API}/getPools/ethereum/main`, {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json'
      }
    });
    
    if (!poolsResponse.ok) {
      throw new Error(`Curve API error: ${poolsResponse.status} ${poolsResponse.statusText}`);
    }
    
    const poolsData = await poolsResponse.json();
    
    if (!poolsData.success) {
      throw new Error(`Curve API returned unsuccessful response`);
    }
    
    const allPools = poolsData.data?.poolData || [];
    
    // Filter for stablecoin pools (main arbitrage targets)
    // Focus on high TVL, high volume pools
    const stablecoinPools = allPools.filter(pool => {
      // Check if pool contains stablecoins
      const hasStables = pool.coins?.some(coin => 
        ['USDC', 'USDT', 'DAI', 'FRAX', 'TUSD', 'BUSD', 'sUSD'].includes(coin.symbol)
      );
      
      // Require minimum TVL for arbitrage viability
      const minTVL = 10000000; // $10M minimum
      const hasLiquidity = parseFloat(pool.usdTotal || 0) > minTVL;
      
      return hasStables && hasLiquidity;
    }).slice(0, 10); // Top 10 by default sort (TVL)
    
    // Process pool data
    const pools = stablecoinPools.map(pool => {
      // Calculate pool composition
      const coins = pool.coins?.map(coin => ({
        address: coin.address,
        symbol: coin.symbol,
        decimals: coin.decimals,
        balance: parseFloat(coin.poolBalance || 0),
        usdPrice: parseFloat(coin.usdPrice || 0)
      })) || [];
      
      // Calculate current exchange rates between coins
      const exchangeRates = [];
      for (let i = 0; i < coins.length; i++) {
        for (let j = i + 1; j < coins.length; j++) {
          if (coins[i].usdPrice > 0 && coins[j].usdPrice > 0) {
            exchangeRates.push({
              from: coins[i].symbol,
              to: coins[j].symbol,
              rate: coins[i].usdPrice / coins[j].usdPrice,
              inverseRate: coins[j].usdPrice / coins[i].usdPrice
            });
          }
        }
      }
      
      return {
        id: pool.id,
        name: pool.name,
        address: pool.address,
        coins,
        tvlUSD: parseFloat(pool.usdTotal || 0),
        volume24h: parseFloat(pool.volumeUSD || 0),
        fee: parseFloat(pool.fee || 0), // Curve fees are typically 0.04% (4 bps)
        virtualPrice: parseFloat(pool.virtualPrice || 0),
        adminFee: parseFloat(pool.adminFee || 0),
        exchangeRates,
        // Curve-specific: A parameter (amplification coefficient)
        amplificationCoefficient: pool.a || null,
        // Pool type
        poolType: pool.poolType || 'stable'
      };
    });
    
    // Fetch additional data from TheGraph if available
    let thegraphData = null;
    if (CURVE_THEGRAPH) {
      try {
        const query = `
          query GetCurvePools {
            pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
              id
              name
              swapFee
              totalValueLockedUSD
              totalVolumeUSD
              swaps(first: 10, orderBy: timestamp, orderDirection: desc) {
                timestamp
                tokenAmountIn
                tokenAmountOut
                amountUSD
              }
            }
          }
        `;
        
        const response = await fetch(CURVE_THEGRAPH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        });
        
        if (response.ok) {
          thegraphData = await response.json();
        }
      } catch (err) {
        // TheGraph is optional, continue without it
        console.warn('TheGraph data fetch failed (optional):', err.message);
      }
    }
    
    // Calculate statistics
    const stats = {
      totalPools: pools.length,
      totalTVL: pools.reduce((sum, p) => sum + p.tvlUSD, 0),
      totalVolume24h: pools.reduce((sum, p) => sum + p.volume24h, 0),
      avgFee: pools.reduce((sum, p) => sum + p.fee, 0) / pools.length,
      hasTheGraphData: !!thegraphData
    };
    
    // Extract arbitrage opportunities (price deviations from $1.00)
    const opportunities = [];
    pools.forEach(pool => {
      pool.coins.forEach(coin => {
        const deviation = Math.abs(coin.usdPrice - 1.0);
        if (deviation > 0.001) { // More than 0.1% deviation
          opportunities.push({
            pool: pool.name,
            poolAddress: pool.address,
            coin: coin.symbol,
            expectedPrice: 1.0,
            actualPrice: coin.usdPrice,
            deviation: deviation,
            deviationPct: (deviation / 1.0) * 100,
            arbitrageType: coin.usdPrice > 1.0 ? 'SELL' : 'BUY'
          });
        }
      });
    });
    
    // Sort opportunities by deviation (largest first)
    opportunities.sort((a, b) => b.deviation - a.deviation);
    
    const duration = Date.now() - startTime;
    
    return {
      fetcher: 'curveFetcher',
      exchange: 'curve',
      timestamp: new Date().toISOString(),
      durationMs: duration,
      status: 'success',
      data: {
        pools,
        opportunities: opportunities.slice(0, 5), // Top 5 opportunities
        stats,
        thegraphData: thegraphData?.data || null
      }
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    return {
      fetcher: 'curveFetcher',
      exchange: 'curve',
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
    console.log('Testing Curve Finance Fetcher...\n');
    const result = await module.exports();
    console.log(JSON.stringify(result, null, 2));
    
    if (result.status === 'success') {
      console.log('\n✅ Fetcher executed successfully');
      console.log(`📊 Pools monitored: ${result.data.stats.totalPools}`);
      console.log(`💰 Total TVL: $${result.data.stats.totalTVL.toFixed(2)}`);
      console.log(`📈 24h Volume: $${result.data.stats.totalVolume24h.toFixed(2)}`);
      console.log(`⚡ Avg Fee: ${(result.data.stats.avgFee * 100).toFixed(3)}%`);
      
      if (result.data.opportunities.length > 0) {
        console.log(`\n🎯 Arbitrage Opportunities Found: ${result.data.opportunities.length}`);
        result.data.opportunities.forEach((opp, i) => {
          console.log(`  ${i + 1}. ${opp.coin} in ${opp.pool}: ${opp.deviationPct.toFixed(3)}% from peg (${opp.arbitrageType})`);
        });
      }
    } else {
      console.log('\n❌ Fetcher failed');
      console.log(`Error: ${result.error.message}`);
    }
  })();
}
