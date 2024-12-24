const WebSocket = require("ws");
const { logger } = require("../monitoring/logger");

/**
 * Parses incoming orderbook messages to extract relevant data.
 * @param {Object} message - The WebSocket message.
 * @returns {Object|null} - Parsed orderbook data or null if the message is not relevant.
 */
function connectToDYDX(markets) {
    const ws = new WebSocket("wss://api.dydx.exchange/v3/ws");

    ws.on("open", () => {
        logger.info("Connected to dYdX WebSocket");
        markets.forEach((market) => {
            const subscriptionMessage = {
                type: "subscribe",
                channel: "v3_orderbook",
                market: market,
            };
            ws.send(JSON.stringify(subscriptionMessage));
            logger.info(`Subscribed to market: ${market}`);
        });
    });

    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data);
            if (message.type === "subscribed") {
                logger.info(
                    `Subscription confirmed for channel: ${message.channel}, market: ${message.market}`
                );
            } else if (message.type === "v3_orderbook") {
                const parsed = parseOrderbookMessage(message);
                if (parsed) {
                    logger.info(
                        `Received orderbook data for market: ${parsed.market}`
                    );
                }
            } else if (message.type === "error") {
                logger.error(
                    `Error from dYdX: ${message.message} (Details: ${JSON.stringify(message)})`
                );
            } else {
                logger.info(`Unhandled message type: ${JSON.stringify(message)}`);
            }
        } catch (err) {
            logger.error(`Error processing WebSocket message: ${err.message}`);
        }
    });

    ws.on("error", (err) => {
        logger.error(`WebSocket error: ${err.message}`);
    });

    ws.on("close", () => {
        logger.info("dYdX WebSocket connection closed");
    });
}


module.exports = { connectToDYDX, parseOrderbookMessage };
