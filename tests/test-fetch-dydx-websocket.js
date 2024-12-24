// Import modules
const { connectToDYDX, parseOrderbookMessage } = require("../data-collection/fetch-dydx-data");
const { logger } = require("../monitoring/logger");

async function testDYDXWebSocket() {
    try {
        logger.info("Starting dYdX WebSocket fetcher test...");
        connectToDYDX(["BTC-USD", "ETH-USD"]);
    } catch (err) {
        logger.error(`Error during test: ${err.message}`);
        logger.debug(`Error stack: ${err.stack}`);
    }
    logger.info("Test completed.");
}

// Enhance test validation with detailed logging
async function testEnhancedOrderbookParsing() {
    logger.info("Testing enhanced orderbook parsing...");
    const sampleMessage = {
        market: "BTC-USD",
        bids: [{ price: "30000", size: "0.1" }],
        asks: [{ price: "30010", size: "0.1" }],
    };
    const parsedData = parseOrderbookMessage(sampleMessage);
    if (parsedData) {
        logger.info(`Parsed Data: ${JSON.stringify(parsedData)}`);
    } else {
        logger.error("Orderbook parsing failed.");
    }
}

testDYDXWebSocket();
testEnhancedOrderbookParsing();
