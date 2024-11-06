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
