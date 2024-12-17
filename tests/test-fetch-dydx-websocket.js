const { startDydxWebSocket } = require('../data-collection/fetch-dydx-websocket');

(async () => {
    console.log('Starting dYdX WebSocket test...');
    startDydxWebSocket();
})();
