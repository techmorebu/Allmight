// Enhanced Sushiswap Fetcher - Direct On-Chain Pool Queries
const { ethers } = require('ethers');

const PROVIDER = new ethers.JsonRpcProvider(
    process.env.ETH_RPC_URL || 'https://eth.llamarpc.com'
);

const PAIR_ABI = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
    'function totalSupply() external view returns (uint256)'
];

const ERC20_ABI = [
    'function decimals() external view returns (uint8)',
    'function symbol() external view returns (string)'
];

// Major Sushiswap pools
const SUSHISWAP_POOLS = [
    {
    name: 'ETH/USDC',
    token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC (correct!)
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH (correct!)
    pair: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0',
    invertPrice: false  // Change to false since we'll use r0/r1
    },
    {
        name: 'WBTC/ETH',
        token0: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58',
        invertPrice: false
    },
    {
        name: 'USDC/USDT',
        token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        pair: '0x06da0fd433C1A5d7a4faa01111c044910A184553',
        invertPrice: false
    },
    {
        name: 'LINK/ETH',
        token0: '0x514910771AF9Ca656af840dff83E8264EcF986CA', // LINK
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xC40D16476380e4037e6b1A2594cAF6a6cc8Da967',
        invertPrice: false
    },
    {
        name: 'UNI/ETH',
        token0: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', // UNI
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xDafd66636E2561b0284EDdE37e42d192F2844D40',
        invertPrice: false
    },
    {
        name: 'AAVE/ETH',
        token0: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', // AAVE
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xD75EA151a61d06868E31F8988D28DFE5E9df57B4',
        invertPrice: false
    },
    {
        name: 'DAI/ETH',
        token0: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
        token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        pair: '0xC3D03e4F041Fd4cD388c549Ee2A29a9E5075882f',
        invertPrice: false
    }
];

async function fetchPoolData(poolConfig) {
    try {
        const pairContract = new ethers.Contract(poolConfig.pair, PAIR_ABI, PROVIDER);
        
        const reserves = await pairContract.getReserves();
        const reserve0 = reserves[0];
        const reserve1 = reserves[1];
        
        const token0Contract = new ethers.Contract(poolConfig.token0, ERC20_ABI, PROVIDER);
        const token1Contract = new ethers.Contract(poolConfig.token1, ERC20_ABI, PROVIDER);
        
        const [decimals0, decimals1] = await Promise.all([
            token0Contract.decimals(),
            token1Contract.decimals()
        ]);
        
        // Convert reserves to numbers with proper decimals - EXPLICIT Number() conversions!
        const dec0 = Number(decimals0.toString());
        const dec1 = Number(decimals1.toString());
        
        const reserve0Num = Number(reserve0.toString()) / Math.pow(10, dec0);
        const reserve1Num = Number(reserve1.toString()) / Math.pow(10, dec1);
        
        // Calculate raw price (token1 per token0)
        let price;
        
        if (poolConfig.name === 'ETH/USDC') {
            // USDC is token0, WETH is token1
            // reserve0/reserve1 = USDC per WETH = dollars per ETH ✅
            price = reserve0Num / reserve1Num;
        } else if (poolConfig.name === 'WBTC/ETH') {
            // WBTC is token0, WETH is token1
            // reserve1/reserve0 = WETH per WBTC ✅
            price = reserve1Num / reserve0Num;
        } else if (poolConfig.name === 'USDC/USDT') {
            // USDC is token0, USDT is token1
            // Both 6 decimals, should be ~1.0
            price = reserve1Num / reserve0Num;
        } else if (poolConfig.name === 'DAI/ETH') {
            // DAI is token0, WETH is token1
            // reserve1/reserve0 = WETH per DAI (tiny number)
            // We want ETH price in DAI, so invert
            price = reserve0Num / reserve1Num;
        } else {
            // TOKEN/ETH pairs (LINK, UNI, AAVE)
            // token0 is TOKEN, token1 is WETH
            // reserve1/reserve0 = WETH per TOKEN ✅
            price = reserve1Num / reserve0Num;
        }
        
        // Calculate TVL
        const tvl = (reserve0Num * price) + reserve1Num;
        
        return {
            pair: poolConfig.name,
            pool: poolConfig.pair,
            price: price,
            reserve0: reserve0.toString(),
            reserve1: reserve1.toString(),
            reserveUSD: tvl,
            fee: 0.3,
            source: 'sushiswap_onchain',
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error(`❌ Error fetching ${poolConfig.name}:`, error.message);
        return null;
    }
}

async function fetchSushiswapData() {
    console.log('🔍 Fetching Sushiswap on-chain data...');
    
    try {
        const results = await Promise.all(
            SUSHISWAP_POOLS.map(pool => fetchPoolData(pool))
        );
        
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
            data: { prices: [], timestamp: new Date().toISOString() }
        };
    }
}

module.exports = fetchSushiswapData;

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
