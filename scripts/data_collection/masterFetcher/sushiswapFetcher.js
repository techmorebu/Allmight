// Enhanced Sushiswap Fetcher - Direct On-Chain Pool Queries
// Queries actual Sushiswap V2 pool reserves and calculates real prices

const { ethers } = require('ethers');

// Ethereum Mainnet RPC
const PROVIDER = new ethers.JsonRpcProvider(
    process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'
);

// Sushiswap V2 Pair ABI (minimal)
const PAIR_ABI = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function totalSupply() external view returns (uint256)'
];

// ERC20 ABI
const ERC20_ABI = [
    'function decimals() external view returns (uint8)',
    'function symbol() external view returns (string)'
];

// Major Sushiswap pools on Ethereum Mainnet
const SUSHISWAP_POOLS = [
    // ETH/USDC
    {
        name: 'ETH/USDC',
        token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        pair: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0'
    },
    // WBTC/ETH
    {
        name: 'WBTC/ETH',
        token0: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58'
    },
    // USDC/USDT
    {
        name: 'USDC/USDT',
        token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        pair: '0x06da0fd433C1A5d7a4faa01111c044910A184553'
    },
    // LINK/ETH
    {
        name: 'LINK/ETH',
        token0: '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xC40D16476380e4037e6b1A2594cAF6a6cc8Da967'
    },
    // UNI/ETH
    {
        name: 'UNI/ETH',
        token0: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xDafd66636E2561b0284EDdE37e42d192F2844D40'
    },
    // AAVE/ETH
    {
        name: 'AAVE/ETH',
        token0: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xD75EA151a61d06868E31F8988D28DFE5E9df57B4'
    },
    // MATIC/ETH
    {
        name: 'MATIC/ETH',
        token0: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', // MATIC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xc2755915a85C6f6c1C0F3a86ac8C058F11Caa9C9'
    },
    // DAI/ETH
    {
        name: 'DAI/ETH',
        token0: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xC3D03e4F041Fd4cD388c549Ee2A29a9E5075882f'
    }
];

/**
 * Calculate price from reserves (Uniswap V2 style)
 */
function calculatePrice(reserve0, reserve1, decimals0, decimals1) {
    const reserve0Adjusted = Number(reserve0) / (10 ** decimals0);
    const reserve1Adjusted = Number(reserve1) / (10 ** decimals1);
    
    // Price of token0 in terms of token1
    return reserve1Adjusted / reserve0Adjusted;
}

/**
 * Calculate TVL from reserves
 */
function calculateTVL(reserve0, reserve1, decimals0, decimals1, price) {
    const reserve0USD = (Number(reserve0) / (10 ** decimals0)) * price;
    const reserve1USD = Number(reserve1) / (10 ** decimals1);
    
    // Total value is sum of both reserves
    return reserve0USD + reserve1USD;
}

/**
 * Fetch data from a single Sushiswap pool
 */
async function fetchPoolData(poolConfig) {
    try {
        const pairContract = new ethers.Contract(poolConfig.pair, PAIR_ABI, PROVIDER);
        
        // Get reserves
        const reserves = await pairContract.getReserves();
        const reserve0 = reserves[0];
        const reserve1 = reserves[1];
        
        // Get token decimals
        const token0Contract = new ethers.Contract(poolConfig.token0, ERC20_ABI, PROVIDER);
        const token1Contract = new ethers.Contract(poolConfig.token1, ERC20_ABI, PROVIDER);
        
        const [decimals0, decimals1] = await Promise.all([
            token0Contract.decimals(),
            token1Contract.decimals()
        ]);
        
        // Calculate price
        const price = calculatePrice(reserve0, reserve1, decimals0, decimals1);
        
        // Calculate TVL
        const tvl = calculateTVL(reserve0, reserve1, decimals0, decimals1, price);
        
        return {
            pair: poolConfig.name,
            pool: poolConfig.pair,
            price: price,
            reserve0: reserve0.toString(),
            reserve1: reserve1.toString(),
            reserveUSD: tvl,
            fee: 0.3, // Sushiswap standard 0.3% fee
            source: 'sushiswap_onchain',
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error(`❌ Error fetching ${poolConfig.name}:`, error.message);
        return null;
    }
}

/**
 * Fetch all Sushiswap pool data
 */
async function fetchSushiswapData() {
    console.log('🔍 Fetching Sushiswap on-chain data...');
    
    try {
        // Fetch all pools in parallel
        const results = await Promise.all(
            SUSHISWAP_POOLS.map(pool => fetchPoolData(pool))
        );
        
        // Filter out failed fetches
        const prices = results.filter(r => r !== null);
        
        console.log(`✅ Fetched ${prices.length}/${SUSHISWAP_POOLS.length} pools`);
        
        return {
            status: 'success',
            data: {
                prices: prices,
                timestamp: new Date().toISOString(),
                source: 'sushiswap_onchain',
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
        console.log('\n📊 SUSHISWAP ON-CHAIN DATA:');
        console.log('═'.repeat(70));
        
        result.data.prices.forEach(price => {
            console.log(`${price.pair.padEnd(15)} $${price.price.toFixed(6).padStart(12)} | TVL: $${(price.reserveUSD/1000000).toFixed(1)}M | Fee: ${price.fee}%`);
        });
        
        console.log('═'.repeat(70));
        console.log(`Total pools: ${result.data.prices.length}`);
    }).catch(console.error);
}

module.exports = fetchSushiswapData;
