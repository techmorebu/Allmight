const { fetchDexData } = require('./fetch-dex-data');

(async () => {
    try {
        // Example GraphQL query for Uniswap or SushiSwap
        const graphQLQuery = `
        {
            pools(first: 5, orderBy: volumeUSD, orderDirection: desc) {
                id
                token0 { symbol }
                token1 { symbol }
                volumeUSD
            }
        }`;

        console.log('--- Fetching Uniswap Data ---');
        const uniswapData = await fetchDexData('uniswap', graphQLQuery);
        console.log('Uniswap Data:', uniswapData);

        console.log('--- Fetching SushiSwap Data ---');
        const sushiswapData = await fetchDexData('sushiswap', graphQLQuery);
        console.log('SushiSwap Data:', sushiswapData);

        console.log('--- Fetching Curve Data (Ethereum) ---');
        const curveDataEth = await fetchDexData('curve_ethereum', graphQLQuery);
        console.log('Curve Ethereum Data:', curveDataEth);

        console.log('--- Fetching QuickSwap Data ---');
        const quickswapData = await fetchDexData('quickswap');
        console.log('QuickSwap Data:', quickswapData);
    } catch (error) {
        console.error('Error fetching DEX data:', error.message);
    }
})();
