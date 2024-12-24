const { connectToDYDX, parseOrderbookMessage } = require("../data-collection/fetch-dydx-data");
const { logger } = require("../monitoring/logger");

async function testDYDXFetcher() {
    logger.info("Starting dYdX WebSocket fetcher test...");

    const sampleMessage = {
        market: "BTC-USD",
        bids: [{ price: "30000", size: "0.1" }],
        asks: [{ price: "30010", size: "0.1" }],
    };

    logger.info("Testing enhanced orderbook parsing...");
    const parsedData = parseOrderbookMessage(sampleMessage);
    logger.info(`Parsed Data: ${JSON.stringify(parsedData)}`);

    const markets = ["BTC-USD", "ETH-USD"];
    connectToDYDX(markets);

    logger.info("Test completed.");
}

testDYDXFetcher().catch((err) => {
    logger.error(`Error during test: ${err.message}`);
});
