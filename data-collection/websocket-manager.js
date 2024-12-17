const WebSocket = require('ws');

/**
 * WebSocketManager class to handle connections and subscriptions
 */
class WebSocketManager {
    constructor() {
        this.connections = {};
    }

    /**
     * Connect to a WebSocket server
     * @param {string} name - Connection name (e.g., GMX)
     * @param {string} url - WebSocket server URL
     * @param {function} onMessage - Callback for incoming messages
     */
    connect(name, url, onMessage) {
        if (this.connections[name]) {
            console.log(`${name} WebSocket is already connected.`);
            return;
        }

        const ws = new WebSocket(url);

        ws.on('open', () => console.log(`${name} WebSocket connected.`));
        ws.on('message', (data) => onMessage(JSON.parse(data)));
        ws.on('error', (err) => console.error(`${name} WebSocket error:`, err));
        ws.on('close', () => {
            console.log(`${name} WebSocket disconnected.`);
            delete this.connections[name];
        });

        this.connections[name] = ws;
    }

    /**
     * Disconnect from a WebSocket server
     * @param {string} name - Connection name
     */
    disconnect(name) {
        if (this.connections[name]) {
            this.connections[name].close();
            console.log(`${name} WebSocket disconnected.`);
        }
    }
}

module.exports = new WebSocketManager();
