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
// Format: [token0, token1, fee, pool_address]
const UNISWAP_V3_POOLS = [
    // ETH/USDC 0.05% fee
    {
        name: 'ETH/USDC',
        token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        fee: 500, // 0.05%
        pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640'
    },
    // ETH/USDC 0.30% fee
    {
        name: 'ETH/USDC',
        token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        fee: 3000, // 0.30%
        pool: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8'
    },
    // WBTC/ETH 0.30% fee
    {
        name: 'WBTC/ETH',
        token0: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0xCBCdF9626bC03E24f779434178A73a0B4bad62eD'
    },
    // USDC/USDT 0.01% fee
    {
        name: 'USDC/USDT',
        token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        fee: 100,
        pool: '0x3416cF6C708Da44DB2624D63ea0AAef7113527C6'
    },
    // LINK/ETH 0.30% fee
    {
        name: 'LINK/ETH',
        token0: '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0xa6Cc3C2531FdaA6Ae1A3CA84c2855806728693e8'
    },
    // UNI/ETH 0.30% fee
    {
        name: 'UNI/ETH',
        token0: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801'
    },
    // AAVE/ETH 0.30% fee
    {
        name: 'AAVE/ETH',
        token0: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0x5aB53EE1d50eeF2C1DD3d5402789cd27bB52c1bB'
    },
    // MATIC/ETH 0.30% fee
    {
        name: 'MATIC/ETH',
        token0: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', // MATIC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fee: 3000,
        pool: '0x290A6a7460B308ee3F19023D2D00dE604bcf5B42'
    }
];

/**
 * Calculate price from Uniswap V3 sqrtPriceX96
 */
function calculatePrice(sqrtPriceX96, decimals0, decimals1) {
    const Q96 = 2n ** 96n;
    const price = (Number(sqrtPriceX96) / Number(Q96)) ** 2;
    const adjustedPrice = price * (10 ** decimals0) / (10 ** decimals1);
    return adjustedPrice;
}

/**
 * Calculate TVL from liquidity
 */
function calculateTVL(liquidity, price, decimals0, decimals1) {
    // Rough approximation - actual TVL calculation is complex
    const liquidityNum = Number(liquidity);
    const tvlInToken1 = liquidityNum * Math.sqrt(price);
    return tvlInToken1 / (10 ** decimals1) * price;
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
        
        // Calculate raw price (amount of token1 per 1 token0)
        let rawPrice = calculatePrice(sqrtPriceX96, decimals0, decimals1);
        
        // For ETH/USDC pools where USDC is token0 and WETH is token1,
        // we want price in USD per ETH, so we need to invert
        let displayPrice = rawPrice;
        
        // Check if we need to invert based on pair name
        if (poolConfig.name === 'ETH/USDC') {
            // USDC is token0, WETH is token1
            // sqrtPrice gives us WETH per USDC, but we want USDC per WETH
            displayPrice = 1 / rawPrice;
        } else if (poolConfig.name.includes('/ETH')) {
            // TOKEN/ETH pairs - keep as is (shows how much ETH for 1 TOKEN)
            displayPrice = rawPrice;
        }
        
        // Calculate TVL (rough estimate)
        const liquidityNum = Number(liquidity) / 1e18; // Rough approximation
        const tvl = liquidityNum * Math.sqrt(displayPrice) * 2;
        
        return {
            pair: poolConfig.name,
            pool: poolConfig.pool,
            price: displayPrice,
            liquidity: Number(liquidity),
            tvlUSD: tvl,
            fee: poolConfig.fee / 10000,
            sqrtPriceX96: sqrtPriceX96.toString(),
            tick: slot0[1],
            rawPrice: rawPrice, // Keep raw for debugging
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
