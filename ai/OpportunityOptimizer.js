const { fetchPriceData } = require("../data_aggregation/DataHandler");

async function evaluateAssets(pairs) {
    const evaluatedPairs = [];

    for (const pair of pairs) {
        const priceData = await fetchPriceData(pair.apiUrl);

        if (priceData && priceData.liquidity > 1000000 && priceData.volume24h > 500000) {
            evaluatedPairs.push(pair);
        }
    }

    return evaluatedPairs;
}

module.exports = {
    evaluateAssets
};


async function testAssetEvaluation() {
    const pairs = [
        { name: "ETH/DAI", apiUrl: "https://api.uniswap.org" },
        { name: "ETH/USDC", apiUrl: "https://api.sushiswap.com" }
    ];
    const filteredPairs = await evaluateAssets(pairs);
    console.log("Filtered pairs:", filteredPairs);
}

testAssetEvaluation();
