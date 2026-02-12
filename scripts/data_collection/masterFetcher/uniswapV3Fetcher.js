// Enhanced Uniswap V3 Fetcher - Direct On-Chain Pool Queries
// Queries actual pool reserves and calculates real prices

const { ethers } = require('ethers');

// Ethereum Mainnet RPC (using public endpoint)
const PROVIDER = new ethers.JsonRpcProvider(
    process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'
);

// Uniswap V3 Pool ABI (minimal - just what we need)
const POOL_ABI = [
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
    'function fee() external view returns (uint24)'
];

// ERC20 ABI (for token info)
const ERC20_ABI = [
    'function decimals() external view returns (uint8)',
    'function symbol() external view returns (string)'
];

// Major Uniswap V3 pools on Ethereum Mainnet
const UNISWAP_V3_POOLS = [
    // ETH/USDC 0.05% fee - WETH is token0, USDC is token1
    {
        name: 'ETH/USDC',
        token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        fee: 500,
        pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        invertPrice: false // WETH/USDC gives USD per ETH directly
    },
    // ETH/USDC 0.30% fee
    {
        name: 'ETH/USDC',
        token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        fee: 3000,
        pool: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        invertPrice: false
    },
    // WBTC/ETH 0.30% fee
    {
        name: 'WBTC/ETH',
        token0: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0xCBCdF9626bC03E24f779434178A73a0B4bad62eD',
        invertPrice: false // Shows ETH per WBTC
    },
    // USDC/USDT 0.01% fee
    {
        name: 'USDC/USDT',
        token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        fee: 100,
        pool: '0x3416cF6C708Da44DB2624D63ea0AAef7113527C6',
        invertPrice: false
    },
    // LINK/ETH 0.30% fee
    {
        name: 'LINK/ETH',
        token0: '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0xa6Cc3C2531FdaA6Ae1A3CA84c2855806728693e8',
        invertPrice: false
    },
    // UNI/ETH 0.30% fee
    {
        name: 'UNI/ETH',
        token0: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801',
        invertPrice: false
    },
    // AAVE/ETH 0.30% fee
    {
        name: 'AAVE/ETH',
        token0: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0x5aB53EE1d50eeF2C1DD3d5402789cd27bB52c1bB',
        invertPrice: false
    },
    // MATIC/ETH 0.30% fee
    {
        name: 'MATIC/ETH',
        token0: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', // MATIC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0x290A6a7460B308ee3F19023D2D00dE604bcf5B42',
        invertPrice: false
    }
];

/**
 * Calculate price from Uniswap V3 tick
 */
function calculatePriceFromTick(tick, decimals0, decimals1) {
    // price = 1.0001^tick (this gives token1 per token0 in their native units)
    const price = Math.pow(1.0001, Number(tick));
    
    // The price needs to be adjusted: divide by 10^(dec0 - dec1)
    // NOT multiply! This converts from native units to human-readable
    const decimalAdj = Math.pow(10, Number(decimals1) - Number(decimals0));
    
    return price * decimalAdj;
}
/**
 * Fetch data from a single Uniswap V3 pool
 */
async function fetchPoolData(poolConfig) {
    try {
        const poolContract = new ethers.Contract(poolConfig.pool, POOL_ABI, PROVIDER);
        
        // Get pool state
        const [slot0, liquidity] = await Promise.all([
            poolContract.slot0(),
            poolContract.liquidity()
        ]);
        
        const sqrtPriceX96 = slot0[0];
        
        // Get token decimals
        const token0Contract = new ethers.Contract(poolConfig.token0, ERC20_ABI, PROVIDER);
        const token1Contract = new ethers.Contract(poolConfig.token1, ERC20_ABI, PROVIDER);
        
        const [decimals0, decimals1] = await Promise.all([
            token0Contract.decimals(),
            token1Contract.decimals()
        ]);
        
        // Calculate price (token1 per token0)
        let price = calculatePriceFromTick(slot0[1], Number(decimals0), Number(decimals1));
        
        // Invert if needed (based on config)
        if (poolConfig.invertPrice) {
            price = 1 / price;
        }
        
        // Simple TVL estimate
        const liquidityNum = Number(liquidity);
        const tvl = liquidityNum / 1e18 * Math.sqrt(price) * 1000; // Rough approximation
        
        return {
            pair: poolConfig.name,
            pool: poolConfig.pool,
            price: price,
            liquidity: liquidityNum,
            tvlUSD: tvl,
            fee: poolConfig.fee / 10000,
            sqrtPriceX96: sqrtPriceX96.toString(),
            tick: Number(slot0[1]),
            source: 'uniswap_v3_onchain',
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error(`❌ Error fetching ${poolConfig.name}:`, error.message);
        return null;
    }
}

/**
 * Fetch all Uniswap V3 pool data
 */
async function fetchUniswapV3Data() {
    console.log('🔍 Fetching Uniswap V3 on-chain data...');
    
    try {
        // Fetch all pools in parallel
        const results = await Promise.all(
            UNISWAP_V3_POOLS.map(pool => fetchPoolData(pool))
        );
        
        // Filter out failed fetches
        const prices = results.filter(r => r !== null);
        
        console.log(`✅ Fetched ${prices.length}/${UNISWAP_V3_POOLS.length} pools`);
        
        return {
            status: 'success',
            data: {
                prices: prices,
                timestamp: new Date().toISOString(),
                source: 'uniswap_v3_onchain',
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
        console.log('\n📊 UNISWAP V3 ON-CHAIN DATA:');
        console.log('═'.repeat(70));
        
        result.data.prices.forEach(price => {
            console.log(`${price.pair.padEnd(15)} $${price.price.toFixed(6).padStart(12)} | TVL: $${(price.tvlUSD/1000000).toFixed(1)}M | Fee: ${price.fee}%`);
        });
        
        console.log('═'.repeat(70));
        console.log(`Total pools: ${result.data.prices.length}`);
    }).catch(console.error);
}

module.exports = fetchUniswapV3Data;
