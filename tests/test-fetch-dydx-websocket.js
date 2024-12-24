const { connectDYDXWebSocket } = require('../data-collection/fetch-dydx-websocket');
const { logger } = require('../monitoring/logger');

function testDYDXWebSocket() {
    const pair = 'BTC-USD'; // Example pair
    logger.info('Testing dYdX WebSocket connection...');
    connectDYDXWebSocket(pair);
}

testDYDXWebSocket();
