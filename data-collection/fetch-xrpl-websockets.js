const WebSocketManager = require('./websocket-manager');
require('dotenv').config();

const XRPL_WEBSOCKET_URL = process.env.XRPL_MAINNET_URL || 'wss://xrplcluster.com';

/**
 * Handle incoming XRPL messages
 * @param {object} data - Parsed WebSocket data
 */
function handleXrplMessage(data) {
    if (data.type === 'ledgerClosed') {
        console.log('XRPL Ledger Update:', data);
    } else if (data.engine_result) {
        console.log('XRPL Transaction:', data);
    } else {
        console.log('XRPL Update:', JSON.stringify(data, null, 2));
    }
}

/**
 * Subscribe to XRPL Ledger and Account Transactions
 * @param {object} ws - WebSocket connection
 * @param {string} account - XRP account to monitor
 */
function subscribeXrpl(ws, account) {
    // Subscribe to ledger updates
    ws.send(JSON.stringify({ id: 1, command: 'subscribe', streams: ['ledger'] }));

    // Subscribe to account transactions (if provided)
    if (account) {
        ws.send(
            JSON.stringify({
                id: 2,
                command: 'subscribe',
                accounts: [account],
            })
        );
    }
}

/**
 * Start XRPL WebSocket connection
 * @param {string} account - Optional XRP account to monitor
 */
function startXrplWebSocket(account = null) {
    WebSocketManager.connect('XRPL', XRPL_WEBSOCKET_URL, handleXrplMessage);

    // Wait for connection to be established and subscribe
    setTimeout(() => {
        const ws = WebSocketManager.connections['XRPL'];
        if (ws) {
            subscribeXrpl(ws, account);
        }
    }, 2000);
}

module.exports = { startXrplWebSocket };
