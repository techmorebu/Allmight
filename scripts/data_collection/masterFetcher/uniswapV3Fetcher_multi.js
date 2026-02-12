// Enhanced Uniswap V3 Fetcher - Multiple Token Pairs
// Fetches prices for multiple tokens from CoinGecko

const axios = require('axios');

// Token pairs to monitor
const TOKEN_PAIRS = [
    { symbol: 'ETH', id: 'ethereum', pair: 'ETH/USDC' },
    { symbol: 'WBTC', id: 'wrapped-bitcoin', pair: 'WBTC/USDC' },
    { symbol: 'LINK', id: 'chainlink', pair: 'LINK/USDC' },
    { symbol: 'UNI', id: 'uniswap', pair: 'UNI/USDC' },
    { symbol: 'AAVE', id: 'aave', pair: 'AAVE/USDC' },
    { symbol: 'ARB', id: 'arbitrum', pair: 'ARB/USDC' },
    { symbol: 'OP', id: 'optimism', pair: 'OP/USDC' },
    { symbol: 'MATIC', id: 'matic-network', pair: 'MATIC/USDC' }
];

// Approximate TVL for each token (in USD)
const APPROXIMATE_TVL = {
    'ETH': 100_000_000,
    'WBTC': 40_000_000,
    'LINK': 10_000_000,
    'UNI': 8_000_000,
    'AAVE': 5_000_000,
    'ARB': 2_000_000,
    'OP': 1_500_000,
    'MATIC': 1_000_000
};

async function fetchUniswapV3Data() {
    try {
        // Get all token IDs for batch request
        const tokenIds = TOKEN_PAIRS.map(t => t.id).join(',');
        
        // Fetch prices from CoinGecko
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: tokenIds,
                vs_currencies: 'usd',
                include_market_cap: true,
                include_24hr_vol: true
            }
        });
        
        // Transform into our format
        const prices = TOKEN_PAIRS.map(token => {
            const data = response.data[token.id];
            
            if (!data) {
                console.log(`⚠️  No data for ${token.symbol}`);
                return null;
            }
            
            return {
                pair: token.pair,
                symbol: token.symbol,
                price: data.usd,
                tvlUSD: APPROXIMATE_TVL[token.symbol] || 1_000_000,
                volume24h: data.usd_24h_vol || 0,
                marketCap: data.usd_market_cap || 0
            };
        }).filter(p => p !== null);
        
        return {
            status: 'success',
            data: {
                prices: prices,
                timestamp: new Date().toISOString(),
                source: 'coingecko',
                exchange: 'uniswap_v3'
            }
        };
        
    } catch (error) {
        console.error('❌ Uniswap V3 fetcher error:', error.message);
        
        return {
            status: 'error',
            error: error.message,
            data: {
                prices: [],
                timestamp: new Date().toISOString()
            }
        };
    }
}

// For testing
if (require.main === module) {
    fetchUniswapV3Data().then(result => {
        console.log('✅ Uniswap V3 Fetcher Test');
        console.log(`Found ${result.data.prices.length} token pairs:`);
        
        result.data.prices.forEach(price => {
            console.log(`  ${price.pair}: $${price.price.toFixed(2)} (TVL: $${(price.tvlUSD/1000000).toFixed(1)}M)`);
        });
    });
}

module.exports = { fetchUniswapV3Data };
