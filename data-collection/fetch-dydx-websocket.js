const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const DYDX_WEBSOCKET_URL = process.env.DYDX_WEBSOCKET_URL || 'wss://api.dydx.exchange/v3/ws';

/**
 * Connect to dYdX WebSocket and subscribe to a trading pair
 * @param {string} pair - The trading pair to subscribe to (e.g., 'BTC-USD')
 */
function connectDYDXWebSocket(pair) {
    const ws = new WebSocket(DYDX_WEBSOCKET_URL);

    ws.on('open', () => {
        logger.info('Connected to dYdX WebSocket');

        const subscriptionMessage = JSON.stringify({
            type: 'subscribe',
            channel: 'v3_orderbook', // Replace 'v3_orderbook' with your desired channel
            id: pair,
        });

        logger.info(`Sending subscription message: ${subscriptionMessage}`);
        ws.send(subscriptionMessage);
    });

    ws.on('message', (data) => {
        logger.info(`Raw message received: ${data}`);
        try {
            const parsedData = JSON.parse(data);

            if (parsedData.type === 'channel_data') {
                logger.info(`Processed data: ${JSON.stringify(parsedData, null, 2)}`);
            } else {
                logger.info(`Unhandled message type: ${JSON.stringify(parsedData, null, 2)}`);
            }
        } catch (error) {
            logger.error(`Error processing message: ${error.message}`);
        }
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
    });

    ws.on('close', (code, reason) => {
        logger.error(`WebSocket closed. Code: ${code}, Reason: ${reason}`);
        // Retry connection after a delay
        setTimeout(() => connectDYDXWebSocket(pair), 5000);
    });
}

/**
 * Fetch and log supported trading pairs from dYdX REST API
 */
async function getDYDXMarkets() {
    const axios = require('axios');
    try {
        const response = await axios.get('https://api.dydx.exchange/v3/markets');
        logger.info(`Available markets: ${JSON.stringify(response.data, null, 2)}`);
    } catch (error) {
        logger.error(`Error fetching markets: ${error.message}`);
    }
}

// Start WebSocket connection for a specific trading pair
const pair = 'BTC-USD'; // Replace with the desired trading pair
logger.info(`Starting WebSocket connection for pair: ${pair}`);
connectDYDXWebSocket(pair);

// Fetch and log dYdX supported markets (optional for debugging)
getDYDXMarkets();
