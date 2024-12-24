// Existing imports and setup
const WebSocket = require("ws");
const { logger } = require("../monitoring/logger");

// Function to connect to dYdX WebSocket
function connectToDYDX(markets) {
    const ws = new WebSocket("wss://api.dydx.exchange/v3/ws");
    ws.on("open", () => {
        logger.info("Connected to dYdX WebSocket");
        markets.forEach((market) => {
            const subscriptionMessage = {
                type: "subscribe",
                channel: "v3_orderbook",
                market,
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

// Adding best bid and ask parsing for v3_orderbook channel
function parseOrderbookMessage(message) {
    try {
        const bestBid = message.bids?.[0];
        const bestAsk = message.asks?.[0];
        return {
            market: message.market,
            bestBid: bestBid ? { price: bestBid.price, size: bestBid.size } : null,
            bestAsk: bestAsk ? { price: bestAsk.price, size: bestAsk.size } : null,
        };
    } catch (err) {
        logger.error(`Error parsing orderbook message: ${err.message}`);
        return null;
    }
}

module.exports = { connectToDYDX, parseOrderbookMessage };
