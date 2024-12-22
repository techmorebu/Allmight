const { startXrplWebSocket } = require('../data-collection/fetch-xrpl-websockets');

(async () => {
    console.log('Starting XRPL WebSocket test...');
    const testAccount = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh'; // Replace with a real XRPL account if needed
    startXrplWebSocket(testAccount);
})();
