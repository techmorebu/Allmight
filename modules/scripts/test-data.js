const { getPriceData, getLiquidityData } = require("../modules/data-collection/data-collection");

async function main() {
    console.log("Fetching price data...");
    const price = await getPriceData();
    console.log("ETH/USD Price:", price);

    console.log("Fetching liquidity data...");
    const liquidity = await getLiquidityData(process.env.CURVE_FINANCE_ETHEREUM_API);
    console.log("Liquidity Data:", liquidity);
}

main().catch((error) => {
    console.error("Error in Data Collection Module Test:", error.message);
    process.exitCode = 1;
});
