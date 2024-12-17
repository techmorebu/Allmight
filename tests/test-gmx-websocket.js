const { startGmxWebSocket } = require('../data-collection/fetch-gmx-websocket');

(async () => {
    console.log('Starting GMX WebSocket test...');
    startGmxWebSocket();
})();
