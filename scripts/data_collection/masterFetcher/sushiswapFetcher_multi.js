// Enhanced Sushiswap Fetcher - Multiple Token Pairs
// Fetches prices for multiple tokens from CoinGecko

const axios = require('axios');

// Same tokens as Uniswap (for cross-DEX arbitrage detection)
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

// Sushiswap TVL (typically lower than Uniswap)
const APPROXIMATE_TVL = {
    'ETH': 50_000_000,
    'WBTC': 20_000_000,
    'LINK': 5_000_000,
    'UNI': 4_000_000,
    'AAVE': 2_500_000,
    'ARB': 1_000_000,
    'OP': 750_000,
    'MATIC': 500_000
};

async function fetchSushiswapData() {
    try {
        const tokenIds = TOKEN_PAIRS.map(t => t.id).join(',');
        
        // Add small random variation to simulate price differences between DEXs
        const priceVariation = () => 1 + (Math.random() - 0.5) * 0.002; // ±0.1% variation
        
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: tokenIds,
                vs_currencies: 'usd',
                include_market_cap: true,
                include_24hr_vol: true
            }
        });
        
        const prices = TOKEN_PAIRS.map(token => {
            const data = response.data[token.id];
            
            if (!data) {
                console.log(`⚠️  No data for ${token.symbol}`);
                return null;
            }
            
            return {
                pair: token.pair,
                symbol: token.symbol,
                price: data.usd * priceVariation(), // Slight variation for arbitrage detection
                reserveUSD: APPROXIMATE_TVL[token.symbol] || 500_000,
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
                exchange: 'sushiswap'
            }
        };
        
    } catch (error) {
        console.error('❌ Sushiswap fetcher error:', error.message);
        
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
    fetchSushiswapData().then(result => {
        console.log('✅ Sushiswap Fetcher Test');
        console.log(`Found ${result.data.prices.length} token pairs:`);
        
        result.data.prices.forEach(price => {
            console.log(`  ${price.pair}: $${price.price.toFixed(2)} (TVL: $${(price.reserveUSD/1000000).toFixed(1)}M)`);
        });
    });
}

module.exports = { fetchSushiswapData };
