const axios = require('axios');
const WebSocket = require('ws');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis();
const DYDX_WS_URL = 'wss://api.dydx.exchange/v3/ws';
const DYDX_API_URL = 'https://api.dydx.exchange/v3/markets';

async function fetchActiveMarkets() {
    try {
        const response = await axios.get(DYDX_API_URL);
        const markets = Object.keys(response.data.markets);
        logger.info(`Fetched ${markets.length} active markets.`);
        return markets;
    } catch (error) {
        logger.error(`Failed to fetch active markets: ${error.message}`);
        throw error;
    }
}

function connectToDYDXWebSocket() {
    const ws = new WebSocket(DYDX_WS_URL);

    ws.on('open', () => {
        logger.info('WebSocket connection established.');
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            if (message.type === 'snapshot' || message.type === 'update') {
                handleOrderBookMessage(message);
            } else {
                logger.debug(`Unhandled message type: ${JSON.stringify(message)}`);
            }
        } catch (error) {
            logger.error(`Failed to parse WebSocket message: ${error.message}`);
        }
    });

    ws.on('error', (error) => {
        logger.error(`WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
        logger.warn('WebSocket connection closed.');
        // Optionally implement retry logic here
    });

    return ws;
}

async function handleOrderBookMessage(message) {
    if (!message.contents || (!message.contents.bids && !message.contents.asks)) {
        logger.warn(`Received empty order book update for market: ${message.id}`);
        return;
    }

    const currentSnapshot = JSON.parse(await redis.get(`dydx:orderbook:${message.id}`)) || { bids: [], asks: [] };

    const updatedSnapshot = mergeOrderBookUpdates(currentSnapshot, message.contents);
    await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(updatedSnapshot));

    const largeVolumeChanges = detectLargeVolumeChanges(currentSnapshot, updatedSnapshot);
    if (largeVolumeChanges.length > 0) {
        logger.alert(`Significant volume changes detected for market ${message.id}: ${JSON.stringify(largeVolumeChanges)}`);
    }

    logger.info(`Updated order book for ${message.id}`);
}

function detectLargeVolumeChanges(oldSnapshot, newSnapshot) {
    const changes = [];
    const compareLevels = (oldLevels, newLevels, side) => {
        newLevels.forEach((newLevel, index) => {
            const oldLevel = oldLevels[index];
            if (oldLevel && newLevel.size !== oldLevel.size) {
                changes.push({
                    side,
                    price: newLevel.price,
                    oldSize: oldLevel.size,
                    newSize: newLevel.size,
                });
            }
        });
    };

    compareLevels(oldSnapshot.bids, newSnapshot.bids, 'bid');
    compareLevels(oldSnapshot.asks, newSnapshot.asks, 'ask');
    return changes;
}

function mergeOrderBookUpdates(snapshot, update) {
    const mergeLevels = (snapshotLevels, updateLevels) => {
        const updatedLevels = [...snapshotLevels];
        updateLevels.forEach((updateLevel) => {
            const index = updatedLevels.findIndex((level) => level.price === updateLevel.price);
            if (index !== -1) {
                if (updateLevel.size === '0') {
                    updatedLevels.splice(index, 1);
                } else {
                    updatedLevels[index] = updateLevel;
                }
            } else if (updateLevel.size !== '0') {
                updatedLevels.push(updateLevel);
            }
        });
        return updatedLevels.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    };

    return {
        bids: mergeLevels(snapshot.bids, update.bids),
        asks: mergeLevels(snapshot.asks, update.asks),
    };
}

module.exports = { fetchActiveMarkets, connectToDYDXWebSocket, handleOrderBookMessage, mergeOrderBookUpdates };
