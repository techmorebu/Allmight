// Enhanced Uniswap V3 Fetcher - Direct On-Chain Pool Queries
const { ethers } = require('ethers');
const { getToken } = require('../../../utils/token_registry');
const { withRetry, withTimeout, buildProviderFromEnv } = require('../../../utils/rpc_helpers');
const { makeFailoverProvider } = require("../../../utils/rpc_provider");
const provider = makeFailoverProvider("ETHEREUM");

const CHAIN = 'ethereum';
const PROVIDER = buildProviderFromEnv({ chain: CHAIN });

const UNISWAP_V3_POOL_ABI = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function fee() external view returns (uint24)'
];

const ERC20_ABI = [
    'function decimals() external view returns (uint8)',
    'function symbol() external view returns (string)'
];

// Major Uniswap V3 pools
const UNISWAP_V3_POOLS = [
    {
        name: 'ETH/USDC',
        token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
        fee: 0.05
    },
    {
        name: 'ETH/USDC',
        token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        pool: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
        fee: 0.3
    },
    {
        name: 'WBTC/ETH',
        token0: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pool: '0xCBCdF9626bC03E24f779434178A73a0B4bad62eD',
        fee: 0.3
    },
    {
        name: 'USDC/USDT',
        token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        pool: '0x3416cF6C708Da44DB2624D63ea0AAef7113527C6',
        fee: 0.01
    },
    {
        name: 'LINK/ETH',
        token0: '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pool: '0xa6Cc3C2531FdaA6Ae1A3CA84c2855806728693e8',
        fee: 0.3
    },
    {
        name: 'UNI/ETH',
        token0: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pool: '0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801',
        fee: 0.3
    },
    {
        name: 'AAVE/ETH',
        token0: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pool: '0x5aB53EE1d50eeF2C1DD3d5402789cd27bB52c1bB',
        fee: 0.3
    },
    {
        name: 'MATIC/ETH',
        token0: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', // MATIC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pool: '0x290A6a7460B308ee3F19023D2D00dE604bcf5B42',
        fee: 0.3
    }
];

function calculatePrice(sqrtPriceX96, decimals0, decimals1) {
    const sqrtPrice = Number(sqrtPriceX96.toString());
    const price = (sqrtPrice * sqrtPrice) / (2 ** 192);
    const adjustedPrice = price * (10 ** (decimals0 - decimals1));
    return adjustedPrice;
}

async function _erc20Meta(address) {
    // First try registry, then fallback to RPC with retry+timeout.
    const reg = getToken(CHAIN, address);
    if (reg && reg.decimals != null && reg.symbol) {
        return { decimals: reg.decimals, symbol: reg.symbol };
    }

    const tokenContract = new ethers.Contract(address, ERC20_ABI, PROVIDER);

    const decimals = await withRetry(
        () => withTimeout(tokenContract.decimals(), 4000, 'erc20.decimals'),
        { retries: 2, baseDelayMs: 300, label: 'erc20.decimals' }
    );

    const symbol = await withRetry(
        () => withTimeout(tokenContract.symbol(), 4000, 'erc20.symbol'),
        { retries: 2, baseDelayMs: 300, label: 'erc20.symbol' }
    );

    return { decimals: Number(decimals.toString()), symbol };
}

async function fetchPoolData(poolConfig) {
    try {
        const poolContract = new ethers.Contract(poolConfig.pool, UNISWAP_V3_POOL_ABI, PROVIDER);

        const slot0 = await withRetry(
            () => withTimeout(poolContract.slot0(), 6000, 'univ3.slot0'),
            { retries: 1, baseDelayMs: 250, label: 'univ3.slot0' }
        );
        const liquidity = await withRetry(
            () => withTimeout(poolContract.liquidity(), 6000, 'univ3.liquidity'),
            { retries: 1, baseDelayMs: 250, label: 'univ3.liquidity' }
        );

        const [meta0, meta1] = await Promise.all([
            _erc20Meta(poolConfig.token0),
            _erc20Meta(poolConfig.token1)
        ]);

        const price = calculatePrice(slot0[0], meta0.decimals, meta1.decimals);

        // Estimate TVL (rough): use liquidity scaled by price.
        // Note: proper UniV3 TVL needs tick-range math; keep this as an indicative metric.
        const tvl = Number(liquidity.toString()) / (10 ** meta0.decimals) * price;

        return {
            pair: poolConfig.name,
            pool: poolConfig.pool,
            price: poolConfig.name === 'ETH/USDC' ? (1 / price) : price,
            liquidity: liquidity.toString(),
            reserveUSD: tvl,
            fee: poolConfig.fee,
            source: 'uniswap_v3_onchain',
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error(`❌ Error fetching ${poolConfig.name}:`, error.message);
        return null;
    }
}

async function fetchUniswapV3Data() {
    console.log('🔍 Fetching Uniswap V3 on-chain data...');

    try {
        const results = await Promise.all(
            UNISWAP_V3_POOLS.map(pool => fetchPoolData(pool))
        );

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
            data: { prices: [], timestamp: new Date().toISOString() }
        };
    }
}

module.exports = fetchUniswapV3Data;

// For testing
if (require.main === module) {
    fetchUniswapV3Data().then(result => {
        console.log('\n📊 UNISWAP V3 ON-CHAIN DATA:');
        console.log('═'.repeat(70));

        result.data.prices.forEach(price => {
            console.log(`${price.pair.padEnd(15)} $${price.price.toFixed(6).padStart(12)} | TVL: $${(price.reserveUSD/1000000).toFixed(1)}M | Fee: ${price.fee}%`);
        });

        console.log('═'.repeat(70));
        console.log(`Total pools: ${result.data.prices.length}`);
    }).catch(console.error);
}
