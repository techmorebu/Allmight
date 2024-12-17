const { startUniswapWebSocket } = require('../data-collection/fetch-uniswap-websocket');

(async () => {
    console.log('Starting Uniswap WebSocket test...');
    startUniswapWebSocket();
})();
