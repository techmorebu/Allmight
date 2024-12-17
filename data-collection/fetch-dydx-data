require('dotenv').config();
const axios = require('axios');
const { logger } = require('../monitoring/logger');

const DYDX_API_URL = process.env.DYDX_API_URL || 'https://api.dydx.exchange';
const DYDX_WEBSOCKET_URL = process.env.DYDX_WEBSOCKET_URL || 'wss://api.dydx.exchange/v3/ws';

/**
 * Fetch market data from dYdX
 * @returns {Promise<object>} dYdX market data
 */
async function fetchDydxMarkets() {
    try {
        logger.info('Fetching dYdX market data...');
        const response = await axios.get(`${DYDX_API_URL}/v3/markets`);
        return response.data;
    } catch (error) {
        logger.error(`Error fetching dYdX market data: ${error.message}`);
        throw error;
    }
}

/**
 * Fetch order book for a specific market
 * @param {string} market - dYdX market symbol (e.g., BTC-USD)
 * @returns {Promise<object>} dYdX order book data
 */
async function fetchDydxOrderBook(market) {
    try {
        logger.info(`Fetching dYdX order book for ${market}...`);
        const response = await axios.get(`${DYDX_API_URL}/v3/orderbook/${market}`);
        return response.data;
    } catch (error) {
        logger.error(`Error fetching dYdX order book for ${market}: ${error.message}`);
        throw error;
    }
}

/**
 * Fetch recent trades for a specific market
 * @param {string} market - dYdX market symbol (e.g., BTC-USD)
 * @returns {Promise<object>} dYdX recent trades
 */
async function fetchDydxTrades(market) {
    try {
        logger.info(`Fetching dYdX recent trades for ${market}...`);
        const response = await axios.get(`${DYDX_API_URL}/v3/trades/${market}`);
        return response.data;
    } catch (error) {
        logger.error(`Error fetching dYdX trades for ${market}: ${error.message}`);
        throw error;
    }
}

module.exports = { fetchDydxMarkets, fetchDydxOrderBook, fetchDydxTrades };
